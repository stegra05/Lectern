import { api, type ProgressEvent, type Card } from '../api';
import type { StoreState, LecternStore, Phase } from '../store-types';

const ACTIVE_SESSION_KEY = 'lectern_active_session_id';

const getInitialState = (): Partial<StoreState> => ({
    step: 'dashboard',
    pdfFile: null,
    deckName: '',
    focusPrompt: '',
    // sourceType and densityTarget are persistent, so we don't reset them here usually,
    // but they are part of the full initial state in store.ts.
    logs: [],
    cards: [],
    progress: { current: 0, total: 0 },
    currentPhase: 'idle',
    sessionId: null,
    isError: false,
    isCancelling: false,
    estimation: null,
    isEstimating: false,
    isHistorical: false,
    editingIndex: null,
    editForm: null,
    isSyncing: false,
    syncSuccess: false,
    syncProgress: { current: 0, total: 0 },
    syncLogs: [],
    confirmModal: { isOpen: false, type: 'lectern', index: -1 },
    searchQuery: '',
    copied: false,
});

export const processGenerationEvent = (
    event: ProgressEvent,
    set: (fn: (state: StoreState) => Partial<StoreState> | StoreState) => void
) => {
    set((prev) => ({ logs: [...prev.logs, event] }));

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

    if (event.type === 'progress_start') {
        set(() => ({ progress: { current: 0, total: (event.data as { total: number }).total } }));
        return;
    }

    if (event.type === 'progress_update') {
        set((prev) => ({
            progress: {
                ...prev.progress,
                current: (event.data as { current: number }).current,
            },
        }));
        return;
    }

    if (event.type === 'card' || event.type === 'card_generated') {
        set((prev) => ({
            cards: [...prev.cards, (event.data as { card: Card }).card],
        }));
        return;
    }

    if (event.type === 'step_start') {
        const phase = (event.data as { phase?: Phase } | undefined)?.phase;
        if (phase) {
            set(() => ({ currentPhase: phase }));
        }
        return;
    }

    if (event.type === 'done') {
        if (typeof window !== 'undefined') {
            localStorage.removeItem(ACTIVE_SESSION_KEY);
        }
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
        set(() => ({ isCancelling: false }));
        return;
    }

    if (event.type === 'error') {
        set(() => ({ isError: true }));
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
                density_target: state.densityTarget,
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
        set({
            cards: session.cards || [],
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
            set({
                sessionId,
                cards: snapshot.cards || [],
                deckName: snapshot.deck_name || '',
                step: 'generating',
                currentPhase: 'generating',
                isHistorical: false,
            });
        } else {
            localStorage.removeItem(ACTIVE_SESSION_KEY);
            set({
                sessionId,
                cards: snapshot.cards || [],
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
        set({
            cards: snapshot.cards || [],
            deckName: snapshot.deck_name || '',
        });
    } catch (error) {
        console.warn('Failed to refresh recovered session:', error);
    }
};
