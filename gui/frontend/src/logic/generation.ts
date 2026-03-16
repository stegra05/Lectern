import { api, type ProgressEvent, type Card, type CoverageData, type SessionData, type ControlSnapshot } from '../api';
import type { StoreState, LecternStore, Phase } from '../store-types';
import { processStreamEvent } from './stream';
import { applyControlSnapshot } from './snapshot';
import { stampUid, stampUids, reconcileCardUids } from '../utils/uid';
import { useLecternStore } from '../store';
import { deriveMaxSlideNumber, normalizeCardMetadata, normalizeCardsMetadata } from '../utils/cardMetadata';

const deriveTotalPages = (cards: Card[], fallback?: number | null): number => {
    return Math.max(fallback ?? 0, deriveMaxSlideNumber(cards));
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

    // CONTROL PLANE: snapshot drives phase/progress authoritatively
    if (event.type === 'control_snapshot') {
        const snapshot = event.data as ControlSnapshot;
        set((state) => {
            // Reject stale snapshots
            if (state.lastSnapshotTimestamp && snapshot.timestamp <= state.lastSnapshotTimestamp) {
                return state;
            }
            return applyControlSnapshot(snapshot);
        });
        return;
    }

    if (event.type === 'card') {
        set((prev) => {
            const raw = (event.data as { card: Card }).card;
            const normalizedCard = normalizeCardMetadata(raw);
            // Prefer backend uid; fall back to client stampUid for legacy compatibility
            const cardWithUid = normalizedCard.uid
                ? { ...normalizedCard, _uid: normalizedCard.uid }
                : stampUid(normalizedCard);
            const nextCards = [...prev.cards, cardWithUid];
            return {
                cards: nextCards,
                totalPages: deriveTotalPages(nextCards, prev.totalPages),
            };
        });
        return;
    }

    if (event.type === 'cards_replaced') {
        set((prev) => {
            const payload = (event.data as { cards?: Card[]; coverage_data?: CoverageData } | undefined) || undefined;
            const normalized = normalizeCardsMetadata(payload?.cards || []);
            const reconciled = reconcileCardUids(prev.cards, normalized);
            return {
                cards: reconciled,
                totalPages: deriveTotalPages(reconciled, prev.totalPages),
                coverageData: payload?.coverage_data ?? prev.coverageData,
            };
        });
        return;
    }

    if (event.type === 'step_start') {
        const data = (event.data as { phase?: Phase } | undefined)?.phase;
        if (!data) {
            // Non-phased step (e.g. Export) — increment setup counter for initial trickle
            useLecternStore.getState().incrementSetupStep();
        }
        return;
    }

    if (event.type === 'step_end') {
        const data = (event.data as { page_count?: number; coverage_data?: CoverageData } | undefined) || undefined;
        if (data?.page_count || data?.coverage_data) {
            set((prev) => ({
                totalPages: data.page_count ?? prev.totalPages,
                coverageData: data.coverage_data ?? prev.coverageData,
            }));
        }
        return;
    }

    if (event.type === 'done') {
        if (typeof window !== 'undefined') {
            localStorage.removeItem(ACTIVE_SESSION_KEY);
        }
        const store = useLecternStore.getState();
        const cardCount = store.cards.length;

        // Add the estimated cost to session spend if available
        const estimation = store.estimation;
        if (estimation && estimation.cost > 0) {
            store.addToSessionSpend(estimation.cost);
        }

        store.addToast('success', `Generation complete — ${cardCount} cards`);
        set((prev) => ({
            step: 'done',
            isCancelling: false,
            totalPages: (event.data as { total_pages?: number } | undefined)?.total_pages ?? prev.totalPages,
            coverageData: (event.data as { coverage_data?: CoverageData } | undefined)?.coverage_data ?? prev.coverageData,
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
        const isRecoverable = (event.data as Record<string, unknown>)?.recoverable === true;

        useLecternStore.getState().addToast('error', msg, 8000);

        if (!isRecoverable) {
            // Fatal error: show full-screen overlay
            set(() => ({ isError: true }));
        }
        // Recoverable errors just show toast, generation continues
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
        coverageData: null,
        lastSnapshotTimestamp: null,
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
                target_card_count: state.targetDeckSize,
                page_range: state.pageRange,
            },
            (event) => processGenerationEvent(event, set)
        );
    } catch (e: unknown) {
        const error = e as Error;
        console.error("Network error or disconnect:", error);
        const { sessionId, currentPhase, deckName } = get();

        // Control Plane Self-Healing: If we disconnected mid-flight, the backend is authoritative.
        // Try recovering the final state from the REST API.
        if (sessionId && currentPhase !== 'complete' && currentPhase !== 'idle') {
            try {
                const session: SessionData = await api.getSession(sessionId);
                if (session && !session.not_found) {
                    const cards = stampUids(normalizeCardsMetadata(session.cards || []));
                    const isErrorState = session.status === 'error';
                    
                    set({
                        cards,
                        logs: (session.logs as import('../api').ProgressEvent[]) || [],
                        totalPages: deriveTotalPages(cards, session.total_pages),
                        coverageData: session.coverage_data || null,
                        deckName: session.deck_name || session.deck || deckName,
                        isHistorical: true, // It's no longer a live streaming session
                        step: isErrorState ? 'generating' : 'done',
                        currentPhase: isErrorState ? 'idle' : 'complete',
                        isError: isErrorState,
                    });
                    
                    if (!isErrorState) {
                        return; // Successfully healed with authoritative backend state
                    }
                }
            } catch (recoveryError) {
                console.error("Failed to recover session state from REST API:", recoveryError);
            }
        }

        const errorMessage = (e as { message?: string })?.message || 'Network error';
        set((prev) => ({
            logs: [
                ...prev.logs,
                { type: 'error', message: errorMessage, timestamp: Date.now() },
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
        const session: SessionData = await api.getSession(sessionId);
        const cards = stampUids(normalizeCardsMetadata(session.cards || []));
        set({
            cards,
            logs: (session.logs as import('../api').ProgressEvent[]) || [],
            totalPages: deriveTotalPages(cards, session.total_pages),
            coverageData: session.coverage_data || null,
            deckName: session.deck_name || session.deck || '',
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
        const snapshot: SessionData = await api.getSession(sessionId);
        localStorage.removeItem(ACTIVE_SESSION_KEY);
        const cards = stampUids(normalizeCardsMetadata(snapshot.cards || []));
        set({
            sessionId,
            cards,
            totalPages: deriveTotalPages(cards, snapshot.total_pages),
            coverageData: snapshot.coverage_data || null,
            deckName: snapshot.deck_name || snapshot.deck || '',
            step: 'done',
            currentPhase: 'complete',
            isHistorical: true,
        });
    } catch (error) {
        console.warn('Session recovery failed:', error);
        localStorage.removeItem(ACTIVE_SESSION_KEY);
        set({ sessionId: null });
    }
};

