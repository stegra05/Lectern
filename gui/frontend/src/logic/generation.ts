import { api, type ProgressEvent, type Card, type CoverageData, type SessionData, type ControlSnapshot } from '../api';
import type { StoreState, LecternStore, Phase, RubricSummary } from '../store-types';
import { processStreamEvent } from './stream';
import { applyControlSnapshot } from './snapshot';
import { stampUid, stampUids, reconcileCardUids } from '../utils/uid';
import { useLecternStore } from '../store';
import { clearActiveSessionId, getActiveSessionId } from './activeSessionStorage';
import { deriveMaxSlideNumber, normalizeCardMetadata, normalizeCardsMetadata } from '../utils/cardMetadata';
import {
    validateCardEventData,
    validateCardsReplacedData,
    validateControlSnapshotData,
    validateGenerationDoneData,
    validateGenerationStoppedDetails,
    validateStepEndData,
} from '../schemas/sse';

const deriveTotalPages = (cards: Card[], fallback?: number | null): number => {
    return Math.max(fallback ?? 0, deriveMaxSlideNumber(cards));
};

const normalizeRubricSummary = (value: unknown): RubricSummary | null => {
    if (!value || typeof value !== 'object') return null;
    const raw = value as Record<string, unknown>;
    const numeric = (key: string): number | null => {
        const parsed = Number(raw[key]);
        return Number.isFinite(parsed) ? parsed : null;
    };

    const avgQuality = numeric('avg_quality');
    const minQuality = numeric('min_quality');
    const maxQuality = numeric('max_quality');
    const belowThresholdCount = numeric('below_threshold_count');
    const totalCards = numeric('total_cards');
    const threshold = numeric('threshold');

    if (
        avgQuality === null ||
        minQuality === null ||
        maxQuality === null ||
        belowThresholdCount === null ||
        totalCards === null ||
        threshold === null
    ) {
        return null;
    }

    return {
        avg_quality: avgQuality,
        min_quality: minQuality,
        max_quality: maxQuality,
        below_threshold_count: belowThresholdCount,
        total_cards: totalCards,
        threshold,
    };
};

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
        set(() => ({ sessionId: sid }));
        return;
    }

    if (event.type === 'session_resumed') {
        const data = event.data as {
            session_id: string;
            cards?: Card[];
            coverage_data?: CoverageData;
            total_pages?: number;
            current_phase?: string;
        } | undefined;
        if (data) {
            const cards = stampUids(normalizeCardsMetadata(data.cards || []));
            const phase = (data.current_phase as Phase) || 'idle';
            set(() => ({
                sessionId: data.session_id,
                cards,
                coverageData: data.coverage_data || null,
                totalPages: data.total_pages || 0,
                currentPhase: phase,
                isResuming: false,
            }));
        }
        return;
    }

    // CONTROL PLANE: snapshot drives phase/progress authoritatively
    if (event.type === 'control_snapshot') {
        const snapshot = validateControlSnapshotData(event.data);
        if (!snapshot) {
            useLecternStore.getState().addToast('warning', 'Ignored malformed control snapshot', 5000);
            return;
        }
        set((state) => {
            // Reject stale snapshots
            if (state.lastSnapshotTimestamp && snapshot.timestamp <= state.lastSnapshotTimestamp) {
                return state;
            }
            return applyControlSnapshot(snapshot as unknown as ControlSnapshot);
        });
        return;
    }

    if (event.type === 'card') {
        set((prev) => {
            const payload = validateCardEventData(event.data);
            if (!payload) return prev;

            const normalizedCard = normalizeCardMetadata(payload.card as unknown as Card);
            const cardWithUid = stampUid(normalizedCard);
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
            const payload = validateCardsReplacedData(event.data);
            if (!payload) return prev;

            const normalized = normalizeCardsMetadata((payload.cards as unknown as Card[]) || []);
            const reconciled = reconcileCardUids(prev.cards, normalized);
            return {
                cards: reconciled,
                totalPages: deriveTotalPages(reconciled, prev.totalPages),
                coverageData: (payload.coverage_data as unknown as CoverageData | undefined) ?? prev.coverageData,
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
        const data = validateStepEndData(event.data);
        if (data?.page_count || data?.coverage_data) {
            set((prev) => ({
                totalPages: data.page_count ?? prev.totalPages,
                coverageData: (data.coverage_data as unknown as CoverageData | undefined) ?? prev.coverageData,
            }));
        }
        return;
    }

    if (event.type === 'done') {
        const store = useLecternStore.getState();
        const cardCount = store.cards.length;

        // Add the estimated cost to session spend if available
        const estimation = store.estimation;
        if (estimation && estimation.cost > 0) {
            store.addToSessionSpend(estimation.cost);
        }

        store.addToast('success', `Generation complete — ${cardCount} cards`);
        const doneData = validateGenerationDoneData(event.data);
        const rubricSummary = normalizeRubricSummary(
            (doneData as Record<string, unknown> | null)?.rubric_summary
        );
        set((prev) => ({
            step: 'done',
            sessionId: null,
            isCancelling: false,
            totalPages: doneData?.total_pages ?? prev.totalPages,
            coverageData: (doneData?.coverage_data as unknown as CoverageData | undefined) ?? prev.coverageData,
            rubricSummary,
        }));
        return;
    }

    if (event.type === 'cancelled') {
        useLecternStore.getState().addToast('warning', 'Generation cancelled');
        set(() => ({ isCancelling: false, sessionId: null }));
        return;
    }

    if (event.type === 'error') {
        const msg = event.message || 'An error occurred';
        const isRecoverable = (event.data as Record<string, unknown>)?.recoverable === true;

        useLecternStore.getState().addToast('error', msg, 8000);

        if (!isRecoverable) {
            // Fatal error: show full-screen overlay
            set(() => ({ isError: true, sessionId: null }));
        }
        // Recoverable errors just show toast, generation continues
    }

    if (event.type === 'warning') {
        const data =
            event.data && typeof event.data === 'object'
                ? (event.data as Record<string, unknown>)
                : undefined;
        const reason = typeof data?.reason === 'string' ? data.reason : '';
        const details = data ? validateGenerationStoppedDetails(data) : null;

        if (reason === 'grounding_non_progress_duplicates') {
            const duplicateDrops = details?.last_batch_duplicate_drop_count ?? 0;
            useLecternStore
                .getState()
                .addToast(
                    'warning',
                    `Generation stopped: duplicate saturation (${duplicateDrops} duplicate drops).`,
                    8000
                );
            return;
        }

        if (reason === 'grounding_non_progress_gate_failures') {
            const gateFailureDrops = details?.last_batch_gate_failure_drop_count ?? 0;
            useLecternStore
                .getState()
                .addToast(
                    'warning',
                    `Generation stopped: grounding gate failures (${gateFailureDrops} failures).`,
                    8000
                );
            return;
        }

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
        isResuming: false,
        isHistorical: false,
        currentPhase: 'idle',
        setupStepsCompleted: 0,
        coverageData: null,
        rubricSummary: null,
        lastSnapshotTimestamp: null,
    });
    try {
        await api.generate(
            {
                pdf_file: state.pdfFile,
                deck_name: state.deckName,
                focus_prompt: state.focusPrompt,
                target_card_count: state.targetDeckSize,
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
                if (session.not_found) {
                    // Nothing to recover from the backend.
                    // Fall through to local error handling below.
                } else {
                    const cards = stampUids(normalizeCardsMetadata(session.cards || []));
                    const isErrorState = session.status === 'error';
                    
                    set({
                        cards,
                        logs: (session.logs as ProgressEvent[]) ?? [],
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

export const handleResume = async (
    sessionId: string,
    pdfFile: File,
    set: (partial: Partial<StoreState> | ((state: StoreState) => Partial<StoreState>)) => void,
    get: () => LecternStore
) => {
    const state = get();
    if (!pdfFile || !state.deckName) return;

    set({
        step: 'generating',
        logs: [],
        progress: { current: 0, total: 0 },
        sessionId,
        isError: false,
        isCancelling: false,
        isResuming: true,
        isHistorical: false,
        currentPhase: 'idle',
        setupStepsCompleted: 0,
        rubricSummary: null,
        lastSnapshotTimestamp: null,
    });
    try {
        await api.generate(
            {
                pdf_file: pdfFile,
                deck_name: state.deckName,
                focus_prompt: state.focusPrompt,
                target_card_count: state.targetDeckSize,
                session_id: sessionId,
            },
            (event) => processGenerationEvent(event, set)
        );
    } catch (e: unknown) {
        const error = e as Error;
        console.error("Network error or disconnect during resume:", error);

        const errorMessage = (e as { message?: string })?.message || 'Network error';
        set((prev) => ({
            logs: [
                ...prev.logs,
                { type: 'error', message: errorMessage, timestamp: Date.now() },
            ],
            isError: true,
            isResuming: false,
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

export const handleCancelAndReset = (
    _set: (partial: Partial<StoreState> | ((state: StoreState) => Partial<StoreState>)) => void,
    get: () => LecternStore,
    doReset: () => void
) => {
    const { sessionId, step } = get();
    if (step !== 'dashboard') {
        api.stopGeneration(sessionId ?? undefined);
    }
    doReset();
};

export const loadSession = async (
    sessionId: string,
    set: (partial: Partial<StoreState> | ((state: StoreState) => Partial<StoreState>)) => void
) => {
    try {
        set({ step: 'generating' });
        const session: SessionData = await api.getSession(sessionId);
        if (session.not_found) {
            throw new Error(`Session not found: ${sessionId}`);
        }
        const cards = stampUids(normalizeCardsMetadata(session.cards || []));
        set({
            cards,
            logs: (session.logs as ProgressEvent[]) ?? [],
            totalPages: deriveTotalPages(cards, session.total_pages),
            coverageData: session.coverage_data || null,
            deckName: session.deck_name || session.deck || '',
            sessionId,
            isHistorical: true,
            rubricSummary: null,
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
    const sessionId = getActiveSessionId();
    if (!sessionId) return;

    try {
        const snapshot: SessionData = await api.getSession(sessionId);
        clearActiveSessionId();
        if (snapshot.not_found) {
            throw new Error(`Session not found: ${sessionId}`);
        }
        const cards = stampUids(normalizeCardsMetadata(snapshot.cards || []));
        set({
            sessionId,
            cards,
            totalPages: deriveTotalPages(cards, snapshot.total_pages),
            coverageData: snapshot.coverage_data || null,
            deckName: snapshot.deck_name || snapshot.deck || '',
            rubricSummary: null,
            step: 'done',
            currentPhase: 'complete',
            isHistorical: true,
        });
    } catch (error) {
        console.warn('Session recovery failed:', error);
        clearActiveSessionId();
        set({ sessionId: null });
    }
};
