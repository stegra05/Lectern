import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    loadSession,
    recoverSessionOnRefresh,
    processGenerationEvent,
    processGenerationEventV2,
    getReplayCursorFromV2Event,
} from '../logic/generation';
import { api } from '../api';
import { validateGenerationStoppedDetails } from '../schemas/sse';
import type { Step } from '../store-types';
import type { Phase } from '../components/PhaseIndicator';
import type { LecternStore, StoreState } from '../store-types';
import { createBatchActions } from '../slices/reviewSlice';

const storeSpies = vi.hoisted(() => ({
    incrementSetupStep: vi.fn(),
    addToast: vi.fn(),
    cards: [] as unknown[],
}));

// Mock dependencies
vi.mock('../api', () => ({
    api: {
        getSession: vi.fn(),
        stopGeneration: vi.fn(),
        generateV2: vi.fn(),
    },
}));

vi.mock('../store', () => ({
    useLecternStore: {
        getState: vi.fn(() => storeSpies),
    },
}));

vi.mock('../utils/uid', () => ({
    stampUid: (card: Record<string, unknown>) => ({
        ...card,
        _uid: (card as { _uid?: string; uid?: string })._uid ?? (card as { uid?: string }).uid ?? 'mock-uid',
    }),
    stampUids: (cards: Record<string, unknown>[]) =>
        cards.map((c) => ({
            ...c,
            _uid: (c as { _uid?: string; uid?: string })._uid ?? (c as { uid?: string }).uid ?? 'mock-uid',
        })),
    reconcileCardUids: (_existing: Record<string, unknown>[], incoming: Record<string, unknown>[]) =>
        incoming.map((c) => ({
            ...c,
            _uid: (c as { _uid?: string; uid?: string })._uid ?? (c as { uid?: string }).uid ?? 'mock-uid',
        })),
}));

describe('generation logic', () => {
    type StoreSetter = (partial: Partial<StoreState> | ((state: StoreState) => Partial<StoreState>)) => void;
    let setMock: StoreSetter;

    beforeEach(() => {
        setMock = vi.fn() as unknown as StoreSetter;
        vi.clearAllMocks();
        storeSpies.incrementSetupStep.mockClear();
        storeSpies.addToast.mockClear();
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

    describe('processGenerationEventV2', () => {
        it('accepts v2 session_started envelope and updates sessionId', () => {
            const setFn = vi.fn();

            processGenerationEventV2(
                {
                    event_version: 2,
                    session_id: 's1',
                    sequence_no: 1,
                    type: 'session_started',
                    message: '',
                    timestamp: Date.now(),
                    data: { mode: 'start' },
                },
                setFn
            );

            expect(setFn).toHaveBeenCalled();
            expect(setFn.mock.calls[0][0]({ replayCursor: null } as unknown as StoreState)).toMatchObject({
                sessionId: 's1',
                replayCursor: 1,
            });
        });

        it('extracts replay cursor from v2 sequence_no', () => {
            const cursor = getReplayCursorFromV2Event({
                event_version: 2,
                session_id: 's1',
                sequence_no: 42,
                type: 'progress_updated',
                message: '',
                timestamp: Date.now(),
                data: { phase: 'generation', current: 1, total: 2 },
            });

            expect(cursor).toBe(42);
        });

        it('maps warning_emitted code/details to legacy warning reason payload', () => {
            const setFn = vi.fn();

            processGenerationEventV2(
                {
                    event_version: 2,
                    session_id: 's1',
                    sequence_no: 7,
                    type: 'warning_emitted',
                    message: 'warn',
                    timestamp: Date.now(),
                    data: {
                        code: 'grounding_non_progress_duplicates',
                        details: { last_batch_duplicate_drop_count: 3 },
                    },
                },
                setFn
            );

            expect(storeSpies.addToast).toHaveBeenCalledWith(
                'warning',
                'Generation stopped: duplicate saturation (3 duplicate drops).',
                8000
            );
        });

        it('maps phase_completed summary to legacy step_end page_count/coverage_data payload', () => {
            const setFn = vi.fn();
            processGenerationEventV2(
                {
                    event_version: 2,
                    session_id: 's1',
                    sequence_no: 8,
                    type: 'phase_completed',
                    message: '',
                    timestamp: Date.now(),
                    data: {
                        phase: 'generation',
                        duration_ms: 1200,
                        summary: {
                            total_pages: 15,
                        },
                    },
                },
                setFn
            );

            const update = setFn.mock.calls[setFn.mock.calls.length - 1][0];
            const result = update({
                totalPages: 0,
                coverageData: null,
            } as unknown as StoreState);
            expect(result).toMatchObject({
                totalPages: 15,
            });
        });

        it('stores replayCursor monotonically from sequence_no', () => {
            const setFn = vi.fn();

            processGenerationEventV2(
                {
                    event_version: 2,
                    session_id: 's1',
                    sequence_no: 10,
                    type: 'progress_updated',
                    message: '',
                    timestamp: Date.now(),
                    data: { phase: 'generation', current: 1, total: 2 },
                },
                setFn
            );
            processGenerationEventV2(
                {
                    event_version: 2,
                    session_id: 's1',
                    sequence_no: 7,
                    type: 'progress_updated',
                    message: '',
                    timestamp: Date.now(),
                    data: { phase: 'generation', current: 2, total: 2 },
                },
                setFn
            );

            const cursorUpdates = setFn.mock.calls
                .map((call) => call[0])
                .filter((update) => {
                    const result = update({ replayCursor: 10, logs: [] } as unknown as StoreState) as Record<string, unknown>;
                    return typeof result === 'object' && result !== null && 'replayCursor' in result;
                });

            expect(cursorUpdates).toHaveLength(2);
            expect(cursorUpdates[0]({ replayCursor: null, logs: [] } as unknown as StoreState)).toMatchObject({ replayCursor: 10 });
            expect(cursorUpdates[1]({ replayCursor: 10, logs: [] } as unknown as StoreState)).toMatchObject({ replayCursor: 10 });
        });

        it('sets currentPhase from phase_started even without control_snapshot', () => {
            const setFn = vi.fn();

            processGenerationEventV2(
                {
                    event_version: 2,
                    session_id: 's1',
                    sequence_no: 11,
                    type: 'phase_started',
                    message: '',
                    timestamp: Date.now(),
                    data: { phase: 'generation' },
                },
                setFn
            );

            const phaseUpdate = setFn.mock.calls
                .map((call) => call[0])
                .find((update) => {
                    const result = update({ logs: [], currentPhase: 'idle' } as unknown as StoreState) as Record<string, unknown>;
                    return typeof result === 'object' && result !== null && result.currentPhase === 'generating';
                });

            expect(phaseUpdate).toBeDefined();
            const result = phaseUpdate!({ logs: [], currentPhase: 'idle' } as unknown as StoreState);
            expect(result).toMatchObject({
                currentPhase: 'generating',
            });
        });

        it('sets currentPhase to complete on session_completed', () => {
            const setFn = vi.fn();

            processGenerationEventV2(
                {
                    event_version: 2,
                    session_id: 's1',
                    sequence_no: 12,
                    type: 'session_completed',
                    message: '',
                    timestamp: Date.now(),
                    data: { summary: { total_pages: 3 } },
                },
                setFn
            );

            const update = setFn.mock.calls[setFn.mock.calls.length - 1][0];
            const result = update({
                logs: [],
                step: 'generating' as Step,
                currentPhase: 'generating' as Phase,
                totalPages: 0,
                coverageData: null,
            } as unknown as StoreState);

            expect(result).toMatchObject({
                step: 'done',
                currentPhase: 'complete',
            });
        });

        it('maps session_completed summary completion outcome fields to legacy done payload', () => {
            const setFn = vi.fn();
            processGenerationEventV2(
                {
                    event_version: 2,
                    session_id: 's1',
                    sequence_no: 13,
                    type: 'session_completed',
                    message: '',
                    timestamp: Date.now(),
                    data: {
                        summary: {
                            total_pages: 70,
                            cards_generated: 68,
                            requested_card_target: 120,
                            target_shortfall: 52,
                            termination_reason_code: 'coverage_sufficient_model_done',
                            termination_reason_text:
                                'Nice work. You already covered the key topics and concepts in good detail.',
                            run_summary_text:
                                'Generated 68 of requested 120 cards. Nice work. You already covered the key topics and concepts in good detail.',
                        },
                    },
                },
                setFn
            );

            const update = setFn.mock.calls[setFn.mock.calls.length - 1][0];
            const result = update({
                logs: [],
                step: 'generating' as Step,
                currentPhase: 'generating' as Phase,
                totalPages: 0,
                coverageData: null,
                rubricSummary: null,
                completionOutcome: null,
            } as unknown as StoreState);

            expect(result).toMatchObject({
                step: 'done',
                currentPhase: 'complete',
                completionOutcome: {
                    requested_card_target: 120,
                    cards_generated: 68,
                    target_shortfall: 52,
                    termination_reason_code: 'coverage_sufficient_model_done',
                },
            });
        });
    });

    describe('handleResume cursor handoff', () => {
        it('passes replayCursor into generateV2 request as after_sequence_no', async () => {
            const getMock = vi.fn(() => ({
                deckName: 'Deck A',
                focusPrompt: '',
                targetDeckSize: 10,
                replayCursor: 15,
            }));
            const setFn = vi.fn();
            const pdfFile = new File(['%PDF-1.4'], 'resume.pdf', { type: 'application/pdf' });

            vi.mocked(api.generateV2).mockResolvedValue(undefined);

            const { handleResume } = await import('../logic/generation');
            await handleResume('s1', pdfFile, setFn as unknown as (partial: Partial<StoreState> | ((state: StoreState) => Partial<StoreState>)) => void, getMock as unknown as () => LecternStore);

            expect(api.generateV2).toHaveBeenCalledWith(
                expect.objectContaining({
                    session_id: 's1',
                    after_sequence_no: 15,
                }),
                expect.any(Function)
            );
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
        it('sets currentPhase to complete on done', () => {
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
            expect(result).toHaveProperty('currentPhase', 'complete');
        });

        it('stores rubric summary from done payload', () => {
            const setFn = vi.fn();
            processGenerationEvent(
                {
                    type: 'done',
                    message: 'Generation complete',
                    data: {
                        total_pages: 5,
                        rubric_summary: {
                            avg_quality: 55.2,
                            min_quality: 30,
                            max_quality: 88,
                            below_threshold_count: 3,
                            total_cards: 12,
                            threshold: 60,
                        },
                    },
                    timestamp: Date.now(),
                },
                setFn
            );

            const update = setFn.mock.calls[setFn.mock.calls.length - 1][0];
            const prevState = {
                step: 'generating' as Step,
                totalPages: 0,
                coverageData: null,
                rubricSummary: null,
            };

            const result = update(prevState);
            expect(result).toHaveProperty('rubricSummary');
            expect((result as { rubricSummary: { avg_quality: number } }).rubricSummary.avg_quality).toBe(55.2);
        });

        it('stores user-facing completion outcome summary from done payload', () => {
            const setFn = vi.fn();
            processGenerationEvent(
                {
                    type: 'done',
                    message: 'Generation complete',
                    data: {
                        total_pages: 70,
                        requested_card_target: 120,
                        cards_generated: 68,
                        target_shortfall: 52,
                        termination_reason_code: 'coverage_sufficient_model_done',
                        termination_reason_text:
                            'Nice work. You already covered the key topics and concepts in good detail.',
                        run_summary_text:
                            'Generated 68 of requested 120 cards. Nice work. You already covered the key topics and concepts in good detail.',
                    },
                    timestamp: Date.now(),
                },
                setFn
            );

            const update = setFn.mock.calls[setFn.mock.calls.length - 1][0];
            const prevState = {
                step: 'generating' as Step,
                totalPages: 0,
                coverageData: null,
                rubricSummary: null,
            };

            const result = update(prevState);
            expect(result).toHaveProperty('completionOutcome');
            expect((result as { completionOutcome: { requested_card_target: number } }).completionOutcome.requested_card_target).toBe(120);
            expect((result as { completionOutcome: { target_shortfall: number } }).completionOutcome.target_shortfall).toBe(52);
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

    describe('processGenerationEvent warning', () => {
        it('shows duplicate saturation warning for grounding_non_progress_duplicates', () => {
            const setFn = vi.fn();

            processGenerationEvent(
                {
                    type: 'warning',
                    message: 'Generation stopped: grounding_non_progress_duplicates',
                    data: {
                        reason: 'grounding_non_progress_duplicates',
                        last_batch_duplicate_drop_count: 3,
                    },
                    timestamp: Date.now(),
                },
                setFn
            );

            expect(storeSpies.addToast).toHaveBeenCalledWith(
                'warning',
                'Generation stopped: duplicate saturation (3 duplicate drops).',
                8000
            );
        });

        it('shows gate failures warning for grounding_non_progress_gate_failures', () => {
            const setFn = vi.fn();

            processGenerationEvent(
                {
                    type: 'warning',
                    message: 'Generation stopped: grounding_non_progress_gate_failures',
                    data: {
                        reason: 'grounding_non_progress_gate_failures',
                        last_batch_gate_failure_drop_count: 5,
                    },
                    timestamp: Date.now(),
                },
                setFn
            );

            expect(storeSpies.addToast).toHaveBeenCalledWith(
                'warning',
                'Generation stopped: grounding gate failures (5 failures).',
                8000
            );
        });

        it('falls back to legacy warning message when reason is absent', () => {
            const setFn = vi.fn();

            processGenerationEvent(
                {
                    type: 'warning',
                    message: 'Legacy warning payload',
                    timestamp: Date.now(),
                },
                setFn
            );

            expect(storeSpies.addToast).toHaveBeenCalledWith('warning', 'Legacy warning payload', 8000);
        });
    });

    describe('GenerationStoppedDetailsSchema parser', () => {
        it('parses generation stopped details payload with optional counts', () => {
            const parsed = validateGenerationStoppedDetails({
                consecutive_zero_promoted_batches: 2,
                last_batch_generated_candidates_count: 8,
                last_batch_grounding_promoted_count: 0,
                last_batch_grounding_dropped_count: 8,
                last_batch_duplicate_drop_count: 3,
                last_batch_gate_failure_drop_count: 5,
            });

            expect(parsed?.consecutive_zero_promoted_batches).toBe(2);
            expect(parsed?.last_batch_generated_candidates_count).toBe(8);
            expect(parsed?.last_batch_grounding_promoted_count).toBe(0);
            expect(parsed?.last_batch_grounding_dropped_count).toBe(8);
            expect(parsed?.last_batch_duplicate_drop_count).toBe(3);
            expect(parsed?.last_batch_gate_failure_drop_count).toBe(5);
        });

        it('returns null when generation stopped details have invalid types', () => {
            const parsed = validateGenerationStoppedDetails({
                consecutive_zero_promoted_batches: 'two',
            });

            expect(parsed).toBeNull();
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
