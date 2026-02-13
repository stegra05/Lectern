import { api, type ProgressEvent, type Card } from '../api';
import type { StoreState, LecternStore, Phase } from '../store-types';
import { processStreamEvent } from './stream';
import { stampUid, stampUids } from '../utils/uid';
import { useLecternStore } from '../store';
import { deriveMaxSlideNumber, normalizeCardMetadata, normalizeCardsMetadata } from '../utils/cardMetadata';

const deriveTotalPages = (cards: Card[]): number => {
    return deriveMaxSlideNumber(cards);
};

const ACTIVE_SESSION_KEY = 'lectern_active_session_id';

export const processGenerationEvent = (
    event: ProgressEvent,
    set: (fn: (state: StoreState) => Partial<StoreState> | StoreState) => void
) => {
    if (processStreamEvent(event, set, { logKey: 'logs', progressKey: 'progress' })) {
        return;
    }
    if (event.type === 'session_start') {
        const sid =
            event.data && typeof event.data === 'object' && 'session_id' in event.data
                ? (event.data as { session_id: string }).session_id
                : null;
        if (typeof window !== 'undefined') {
            if (sid) localStorage.setItem(ACTIVE_SESSION_KEY, sid);
            else localStorage.removeItem(ACTIVE_SESSION_KEY);
        }
        set(() => ({ sessionId: sid }));
        return;
    }

    if (event.type === 'card') {
        set((prev) => {
            const normalizedCard = normalizeCardMetadata((event.data as { card: Card }).card);
            const nextCards = [...prev.cards, stampUid(normalizedCard)];
            return {
                cards: nextCards,
                totalPages: Math.max(prev.totalPages, deriveTotalPages(nextCards)),
            };
        });
        return;
    }

    if (event.type === 'step_start') {
        const phase = (event.data as { phase?: Phase } | undefined)?.phase;
        if (phase) {
            set(() => ({ currentPhase: phase }));
        } else {
            // Pre-concept setup step — increment counter for progress tracking
            useLecternStore.getState().incrementSetupStep();
        }
        return;
    }

    if (event.type === 'done') {
        if (typeof window !== 'undefined') {
            localStorage.removeItem(ACTIVE_SESSION_KEY);
        }
        const cardCount = useLecternStore.getState().cards.length;
        useLecternStore.getState().addToast('success', `Generation complete — ${cardCount} cards`);
        set((prev) => ({
            step: 'done',
            currentPhase: 'complete',
            isCancelling: false,
            progress: { ...prev.progress, current: prev.progress.total },
        }));
        return;
    }

    if (event.type === 'cancelled') {
        if (typeof window !== 'undefined') {
            localStorage.removeItem(ACTIVE_SESSION_KEY);
        }
        useLecternStore.getState().addToast('warning', 'Generation cancelled');
        set(() => ({ isCancelling: false }));
        return;
    }

    if (event.type === 'error') {
        const msg = event.message || 'An error occurred';
        useLecternStore.getState().addToast('error', msg, 8000);
        set(() => ({ isError: true }));
    }

    if (event.type === 'warning') {
        const msg = event.message || 'Warning';
        useLecternStore.getState().addToast('warning', msg, 8000);
    }
};

export const handleGenerate = async (
    set: (partial: Partial<StoreState> | ((state: StoreState) => Partial<StoreState>)) => void,
    get: () => LecternStore
) => {
    const state = get();
    if (!state.pdfFile || !state.deckName) return;

    set({
        step: 'generating',
        logs: [],
        cards: [],
        progress: { current: 0, total: 0 },
        sessionId: null,
        isError: false,
        isCancelling: false,
        isHistorical: false,
        currentPhase: 'idle',
        setupStepsCompleted: 0,
    });
    if (typeof window !== 'undefined') {
        localStorage.removeItem(ACTIVE_SESSION_KEY);
    }

    try {
        await api.generate(
            {
                pdf_file: state.pdfFile,
                deck_name: state.deckName,
                focus_prompt: state.focusPrompt,
                source_type: state.sourceType,
                target_card_count: state.targetDeckSize,
            },
            (event) => processGenerationEvent(event, set)
        );
    } catch (e) {
        console.error(e);
        set((prev) => ({
            logs: [
                ...prev.logs,
                { type: 'error', message: 'Network error', timestamp: Date.now() },
            ],
            isError: true,
        }));
    }
};

export const handleCancel = (
    set: (partial: Partial<StoreState> | ((state: StoreState) => Partial<StoreState>)) => void,
    get: () => LecternStore
) => {
    const { sessionId } = get();
    set({ isCancelling: true });
    api.stopGeneration(sessionId ?? undefined);
};

export const loadSession = async (
    sessionId: string,
    set: (partial: Partial<StoreState> | ((state: StoreState) => Partial<StoreState>)) => void
) => {
    try {
        set({ step: 'generating' });
        const session = await api.getSession(sessionId);
        const cards = stampUids(normalizeCardsMetadata(session.cards || []));
        set({
            cards,
            totalPages: deriveTotalPages(cards),
            deckName: session.deck_name || '',
            sessionId,
            isHistorical: true,
            step: 'done',
            currentPhase: 'complete',
        });
    } catch (e) {
        console.error('Failed to load session:', e);
        set({ step: 'dashboard' });
    }
};

export const recoverSessionOnRefresh = async (
    set: (partial: Partial<StoreState> | ((state: StoreState) => Partial<StoreState>)) => void
) => {
    if (typeof window === 'undefined') return;
    const sessionId = localStorage.getItem(ACTIVE_SESSION_KEY);
    if (!sessionId) return;

    try {
        const status = await api.getSessionStatus(sessionId);
        const snapshot = await api.getSession(sessionId);
        if (status.active) {
            const cards = stampUids(normalizeCardsMetadata(snapshot.cards || []));
            set({
                sessionId,
                cards,
                totalPages: deriveTotalPages(cards),
                deckName: snapshot.deck_name || '',
                step: 'generating',
                currentPhase: 'generating',
                isHistorical: false,
            });
        } else {
            localStorage.removeItem(ACTIVE_SESSION_KEY);
            const cards = stampUids(normalizeCardsMetadata(snapshot.cards || []));
            set({
                sessionId,
                cards,
                totalPages: deriveTotalPages(cards),
                deckName: snapshot.deck_name || '',
                step: 'done',
                currentPhase: 'complete',
                isHistorical: true,
            });
        }
    } catch (error) {
        console.warn('Session recovery failed:', error);
        localStorage.removeItem(ACTIVE_SESSION_KEY);
        set({ sessionId: null });
    }
};

export const refreshRecoveredSession = async (
    set: (partial: Partial<StoreState> | ((state: StoreState) => Partial<StoreState>)) => void,
    get: () => LecternStore
) => {
    const { sessionId, step } = get();
    if (!sessionId || step !== 'generating') return;
    try {
        const status = await api.getSessionStatus(sessionId);
        if (!status.active) {
            if (typeof window !== 'undefined') {
                localStorage.removeItem(ACTIVE_SESSION_KEY);
            }
            set({ step: 'done', currentPhase: 'complete', isHistorical: true });
            return;
        }
        const snapshot = await api.getSession(sessionId);
        const cards = stampUids(normalizeCardsMetadata(snapshot.cards || []));
        set({
            cards,
            totalPages: deriveTotalPages(cards),
            deckName: snapshot.deck_name || '',
        });
    } catch (error) {
        console.warn('Failed to refresh recovered session:', error);
    }
};
