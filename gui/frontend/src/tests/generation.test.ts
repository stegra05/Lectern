import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadSession, recoverSessionOnRefresh, processGenerationEvent } from '../logic/generation';
import { api } from '../api';
import type { Step } from '../store-types';
import type { Phase } from '../components/PhaseIndicator';
import type { LecternStore, StoreState } from '../store-types';
import { createBatchActions } from '../slices/reviewSlice';

// Mock dependencies
vi.mock('../api', () => ({
    api: {
        getSession: vi.fn(),
        stopGeneration: vi.fn(),
    },
}));

vi.mock('../store', () => ({
    useLecternStore: {
        getState: vi.fn(() => ({
            incrementSetupStep: vi.fn(),
            addToast: vi.fn(),
            cards: [],
        })),
    },
}));

vi.mock('../utils/uid', () => ({
    stampUid: (card: Record<string, unknown>) => ({ ...card, _uid: (card as { _uid?: string })._uid ?? 'mock-uid' }),
    stampUids: (cards: Record<string, unknown>[]) => cards.map(c => ({ ...c, _uid: (c as { _uid?: string })._uid ?? 'mock-uid' })),
    reconcileCardUids: (_existing: Record<string, unknown>[], incoming: Record<string, unknown>[]) =>
        incoming.map(c => ({ ...c, _uid: (c as { _uid?: string })._uid ?? 'mock-uid' })),
}));

describe('generation logic', () => {
    type StoreSetter = (partial: Partial<StoreState> | ((state: StoreState) => Partial<StoreState>)) => void;
    let setMock: StoreSetter;

    beforeEach(() => {
        setMock = vi.fn() as unknown as StoreSetter;
        vi.clearAllMocks();
        localStorage.clear();
    });

    describe('loadSession', () => {
        it('prefers persisted total_pages metadata over card max', async () => {
            vi.mocked(api.getSession).mockResolvedValue({
                id: 'history-entry-1',
                cards: [{ slide_number: 3, front: 'A', back: 'B' }],
                logs: [],
                status: 'completed',
                session_id: 'test-session',
                deck_name: 'Test Deck',
                total_pages: 12,
            });

            await loadSession('test-session', setMock);

            expect(setMock).toHaveBeenCalledWith(expect.objectContaining({
                totalPages: 12,
            }));
        });

        it('derives totalPages from cards', async () => {
            const mockCards = [
                { slide_number: 1, front: 'A', back: 'B' },
                { slide_number: 5, front: 'C', back: 'D' },
                { slide_number: 3, front: 'E', back: 'F' }, // Max is 5
            ];
            vi.mocked(api.getSession).mockResolvedValue({
                id: 'history-entry-2',
                cards: mockCards,
                logs: [],
                status: 'completed',
                session_id: 'test-session',
                deck_name: 'Test Deck',
            });

            await loadSession('test-session', setMock);

            expect(setMock).toHaveBeenCalledWith(expect.objectContaining({
                totalPages: 5,
                sessionId: 'test-session',
                isHistorical: true,
            }));
        });

        it('handles sessions with no cards', async () => {
            vi.mocked(api.getSession).mockResolvedValue({
                id: 'history-entry-3',
                cards: [],
                logs: [],
                status: 'completed',
                session_id: 'empty-session',
                deck_name: 'Empty Deck',
            });

            await loadSession('empty-session', setMock);

            expect(setMock).toHaveBeenCalledWith(expect.objectContaining({
                totalPages: 0,
                cards: [],
            }));
        });
    });

    describe('recoverSessionOnRefresh', () => {
        it('derives totalPages for active session', async () => {
            localStorage.setItem('lectern_active_session_id', 'active-session');
            vi.mocked(api.getSession).mockResolvedValue({
                id: 'history-entry-active',
                cards: [{ slide_number: 10 }],
                logs: [],
                status: 'completed',
                session_id: 'active-session',
                deck_name: 'Active Deck',
            });

            await recoverSessionOnRefresh(setMock);

            expect(setMock).toHaveBeenCalledWith(expect.objectContaining({
                totalPages: 10,
                isHistorical: true,
            }));
        });
    });

    describe('processGenerationEvent cards_replaced', () => {
        it('reconciles cards and preserves totalPages when higher', () => {
            const setFn = vi.fn();
            processGenerationEvent(
                {
                    type: 'cards_replaced',
                    message: 'Applied reflection batch',
                    data: { cards: [{ front: 'A', back: 'B', fields: { Front: 'A', Back: 'B' } }] },
                    timestamp: Date.now(),
                },
                setFn
            );
            expect(setFn).toHaveBeenCalled();
            // processStreamEvent appends to logs first; cards_replaced handler is a subsequent call
            const update = setFn.mock.calls[setFn.mock.calls.length - 1][0];
            expect(typeof update).toBe('function');
            const prevState = {
                cards: [{ front: 'X', back: 'Y', _uid: 'old' }],
                totalPages: 10,
                progress: { current: 0, total: 10 },
            };
            const result = update(prevState);
            expect(result).toHaveProperty('cards');
            expect(result).toHaveProperty('totalPages');
            expect((result as { cards: unknown[] }).cards).toHaveLength(1);
            expect((result as { totalPages: number }).totalPages).toBe(10);
        });
    });

    describe('processGenerationEvent validation', () => {
        it('ignores malformed card payloads (does not mutate cards)', () => {
            const setFn = vi.fn();
            processGenerationEvent(
                {
                    type: 'card',
                    message: 'Card event',
                    data: { not_a_card: true },
                    timestamp: Date.now(),
                },
                setFn
            );

            // First call is log append; last call is the card handler state update.
            const update = setFn.mock.calls[setFn.mock.calls.length - 1][0];
            const prevState = {
                cards: [],
                totalPages: 0,
                progress: { current: 0, total: 0 },
            };

            const result = update(prevState);
            expect(result).toBe(prevState);
        });

        it('ignores malformed control snapshots (does not apply snapshot)', () => {
            const setFn = vi.fn();
            processGenerationEvent(
                {
                    type: 'control_snapshot',
                    message: 'snapshot',
                    data: { bogus: true },
                    timestamp: Date.now(),
                },
                setFn
            );

            // Only the log append call should happen; snapshot branch returns early.
            expect(setFn).toHaveBeenCalledTimes(1);
        });
    });

    describe('processGenerationEvent done', () => {
        it('does not set currentPhase (Fix 2: Authority moved to snapshots)', () => {
            const setFn = vi.fn();
            processGenerationEvent(
                {
                    type: 'done',
                    message: 'Generation complete',
                    data: { total_pages: 5 },
                    timestamp: Date.now(),
                },
                setFn
            );
            
            const update = setFn.mock.calls[setFn.mock.calls.length - 1][0];
            const prevState = {
                step: 'generating' as Step,
                currentPhase: 'generating' as Phase,
                progress: { current: 5, total: 10 },
            };
            
            const result = update(prevState);
            expect(result).toHaveProperty('step', 'done');
            expect(result).not.toHaveProperty('currentPhase');
            expect(result).not.toHaveProperty('progress');
        });
    });

    describe('processGenerationEvent side effects', () => {
        it('does not touch localStorage for session_start events', () => {
            const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
            const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem');

            const setFn = vi.fn();
            processGenerationEvent(
                {
                    type: 'session_start',
                    message: 'Session started',
                    data: { session_id: 'abc123' },
                    timestamp: Date.now(),
                },
                setFn
            );

            expect(setItemSpy).not.toHaveBeenCalledWith('lectern_active_session_id', expect.any(String));
            expect(removeItemSpy).not.toHaveBeenCalledWith('lectern_active_session_id');
        });

        it('does not touch localStorage for done events', () => {
            const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem');

            const setFn = vi.fn();
            processGenerationEvent(
                {
                    type: 'done',
                    message: 'Generation complete',
                    data: { total_pages: 5 },
                    timestamp: Date.now(),
                },
                setFn
            );

            expect(removeItemSpy).not.toHaveBeenCalledWith('lectern_active_session_id');
        });
    });

    describe('batch actions selection scope', () => {
        it('selects only visible card uids when a scoped list is provided', () => {
            type ScopedSelectAll = {
                selectAllCards: (uids: string[]) => void;
            };

            type BatchSelectionState = Pick<StoreState, 'cards' | 'selectedCards' | 'lastSelectedUid'> &
                Pick<LecternStore, 'clearBatchDeletedCard' | 'addToast' | 'undoBatchDelete' | 'batchDeletedCards' | 'confirmModal' | 'isMultiSelectMode'>;

            const state: BatchSelectionState = {
                cards: [
                    { front: 'A', back: 'A', fields: { Front: 'A', Back: 'A' }, _uid: 'uid-a' },
                    { front: 'B', back: 'B', fields: { Front: 'B', Back: 'B' }, _uid: 'uid-b' },
                    { front: 'C', back: 'C', fields: { Front: 'C', Back: 'C' }, _uid: 'uid-c' },
                ],
                selectedCards: new Set<string>(),
                lastSelectedUid: null,
                clearBatchDeletedCard: vi.fn(),
                addToast: vi.fn(),
                undoBatchDelete: vi.fn(),
                batchDeletedCards: [],
                confirmModal: { isOpen: false, type: 'lectern', index: -1 },
                isMultiSelectMode: true,
            };

            const setState = (
                partial: Partial<StoreState> | ((state: StoreState) => Partial<StoreState>)
            ) => {
                const update =
                    typeof partial === 'function'
                        ? partial(state as unknown as StoreState)
                        : partial;
                Object.assign(state, update);
            };
            const getState = () => state as unknown as LecternStore;

            const actions = createBatchActions(setState, getState) as unknown as ScopedSelectAll;
            actions.selectAllCards(['uid-a', 'uid-c']);

            expect(state.selectedCards).toEqual(new Set(['uid-a', 'uid-c']));
        });
    });
});
