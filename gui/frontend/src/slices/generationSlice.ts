import type { StoreState, LecternStore, GenerationActions, ProgressTrackingActions, Step } from "../store-types";
import type { Phase } from "../components/PhaseIndicator";
import * as generationLogic from "../logic/generation";
import { stampUid } from "../utils/uid";

export const getGenerationState = () => ({
  step: "dashboard" as Step,
  pdfFile: null as File | null,
  deckName: "",
  focusPrompt: "",
  targetDeckSize: 1,
  densityPreferences: { per1k: null as number | null, perSlide: null as number | null },
  logs: [] as import("../api").ProgressEvent[],
  progress: { current: 0, total: 0 },
  currentPhase: "idle" as Phase,
  isError: false,
  isCancelling: false,
  isResuming: false,
  replayCursor: null as number | null,
  estimation: null as import("../api").Estimation | null,
  isEstimating: false,
  estimationError: null as string | null,
  totalPages: 0,
  coverageData: null as import("../api").CoverageData | null,
  rubricSummary: null as import("../store-types").RubricSummary | null,
  completionOutcome: null as import("../store-types").CompletionOutcome | null,
  setupStepsCompleted: 0,
  conceptProgress: { current: 0, total: 0 },
  lastSnapshotTimestamp: null as number | null,
});

export const getSessionState = () => ({
  sessionId: null as string | null,
  isHistorical: false,
});

const preservePersistedState = (state: StoreState) => ({
  densityPreferences: state.densityPreferences,
  deckName: state.deckName,
  sortBy: state.sortBy,
  totalSessionSpend: state.totalSessionSpend,
});

export const createGenerationActions = (
  getInitialState: () => StoreState,

  set: (state: Partial<StoreState> | ((state: StoreState) => Partial<StoreState>)) => void,
  get: () => LecternStore
): GenerationActions => ({
  setStep: (step) => set({ step }),
  setPdfFile: (file) => set({
    pdfFile: file,
    // Reset estimation state when file changes to prevent stale data
    estimation: null,
    estimationError: null,
    isEstimating: false,
  }),
  setDeckName: (name) => set({ deckName: name }),
  setFocusPrompt: (prompt) => set({ focusPrompt: prompt }),
  setTargetDeckSize: (target) => {
    set({ targetDeckSize: target });
    
    // Update density preferences when user manually adjusts target size
    const state = get();
    if (state.estimation) {
      const pageCount = state.estimation.pages || 1;
      const textChars = state.estimation.text_chars || 0;
      const avgChars = textChars / pageCount;
      const isScript = avgChars > 1500; // SCRIPT_THRESHOLD

      if (isScript && textChars > 0) {
        const per1k = (target * 1000) / textChars;
        set((s) => ({
          densityPreferences: { ...s.densityPreferences, per1k }
        }));
      } else if (!isScript && pageCount > 0) {
        const perSlide = target / pageCount;
        set((s) => ({
          densityPreferences: { ...s.densityPreferences, perSlide }
        }));
      }
    }
  },
  setEstimation: (est) => set({ estimation: est, estimationError: null }),
  setEstimationError: (error) => set({ estimationError: error }),
  setTotalPages: (n) => set({ totalPages: n }),
  recommendTargetDeckSize: (est) => {
    set({ totalPages: est.pages, coverageData: null });

    const pageCount = est.pages || 1;
    const textChars = est.text_chars || 0;
    const avgChars = textChars / pageCount;
    const isScript = avgChars > 1500; // SCRIPT_THRESHOLD

    let preferredTarget: number | null = null;
    const prefs = get().densityPreferences;

    if (isScript) {
      if (prefs.per1k !== null) {
        preferredTarget = Math.round((prefs.per1k * textChars) / 1000);
      }
    } else {
      if (prefs.perSlide !== null) {
        preferredTarget = Math.round(prefs.perSlide * pageCount);
      }
    }

    if (preferredTarget !== null) {
      // Clamp to min 1
      set({ targetDeckSize: Math.max(1, preferredTarget) });
    } else if (est.suggested_card_count) {
      // Fallback to backend suggestion if no preference
      set({ targetDeckSize: est.suggested_card_count });
    }
  },
  setIsEstimating: (value) => set({ isEstimating: value }),
  setIsError: (value) => set({ isError: value }),
  setIsCancelling: (value) => set({ isCancelling: value }),
  setSessionId: (id) => set({ sessionId: id }),
  setProgress: (update) =>
    set((state) => ({
      progress: {
        current:
          update.current !== undefined ? update.current : state.progress.current,
        total: update.total !== undefined ? update.total : state.progress.total,
      },
    })),
  appendLog: (event) =>
    set((state) => ({
      logs: [...state.logs, event],
    })),
  appendCard: (card) =>
    set((state) => ({
      cards: [...state.cards, stampUid(card)],
    })),
  reset: () => {
    const currentState = get();
    set({ ...getInitialState(), ...preservePersistedState(currentState) });
  },
  handleGenerate: () => generationLogic.handleGenerate(set, get),
  handleResume: (sessionId, pdfFile) => generationLogic.handleResume(sessionId, pdfFile, set, get),
  handleCancel: () => generationLogic.handleCancel(set, get),
  handleCancelAndReset: () =>
    generationLogic.handleCancelAndReset(set, get, () => {
      const currentState = get();
      set({ ...getInitialState(), ...preservePersistedState(currentState) });
    }),
  handleReset: () => {
    const currentState = get();
    set({ ...getInitialState(), ...preservePersistedState(currentState) });
  },
  handleCopyLogs: () => {
    const { logs } = get();
    const text = logs
      .map(
        (log) =>
          `[${new Date(log.timestamp).toLocaleTimeString()}] ${log.type.toUpperCase()}: ${log.message}`
      )
      .join('\n');
    navigator.clipboard.writeText(text);
    set({ copied: true });
    get().addToast('success', 'Logs copied to clipboard', 2500);
    setTimeout(() => set({ copied: false }), 2000);
  },
  loadSession: (sessionId) => generationLogic.loadSession(sessionId, set),
  recoverSessionOnRefresh: () => generationLogic.recoverSessionOnRefresh(set),
});

export const createProgressTrackingActions = (
  set: (state: Partial<StoreState> | ((state: StoreState) => Partial<StoreState>)) => void
): ProgressTrackingActions => ({
  incrementSetupStep: () =>
    set((state) => ({
      setupStepsCompleted: Math.min(state.setupStepsCompleted + 1, 4),
    })),
  setConceptProgress: (progress) =>
    set(() => ({
      conceptProgress: progress,
    })),
});
