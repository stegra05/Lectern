import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadSession, recoverSessionOnRefresh, refreshRecoveredSession } from '../logic/generation';
import { api } from '../api';
import { useLecternStore } from '../store';

// Mock dependencies
vi.mock('../api', () => ({
    api: {
        getSession: vi.fn(),
        getSessionStatus: vi.fn(),
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
    stampUid: (card: any) => ({ ...card, _uid: 'mock-uid' }),
    stampUids: (cards: any[]) => cards.map(c => ({ ...c, _uid: 'mock-uid' })),
}));

describe('generation logic', () => {
    let setMock: any;
    let getMock: any;

    beforeEach(() => {
        setMock = vi.fn();
        getMock = vi.fn();
        vi.clearAllMocks();
        localStorage.clear();
    });

    describe('loadSession', () => {
        it('derives totalPages from cards', async () => {
            const mockCards = [
                { slide_number: 1, front: 'A', back: 'B' },
                { slide_number: 5, front: 'C', back: 'D' },
                { slide_number: 3, front: 'E', back: 'F' }, // Max is 5
            ];
            (api.getSession as any).mockResolvedValue({
                cards: mockCards,
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
            (api.getSession as any).mockResolvedValue({
                cards: [],
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
            (api.getSessionStatus as any).mockResolvedValue({ active: true });
            (api.getSession as any).mockResolvedValue({
                cards: [{ slide_number: 10 }],
                deck_name: 'Active Deck',
            });

            await recoverSessionOnRefresh(setMock);

            expect(setMock).toHaveBeenCalledWith(expect.objectContaining({
                totalPages: 10,
                isHistorical: false,
            }));
        });
    });
});
