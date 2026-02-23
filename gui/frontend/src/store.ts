import { create } from 'zustand';

import { api, type ProgressEvent } from './api';
import type { Phase } from './components/PhaseIndicator';
import type {
  StoreState,
  LecternStore,
  GenerationActions,
  ReviewActions,
  UiActions,
  ToastActions,
  ProgressTrackingActions,
  BatchActions,
  BudgetActions,
  Step,
} from './store-types';
import type { SortOption } from './hooks/types';
import * as generationLogic from './logic/generation';
import { processStreamEvent } from './logic/stream';
import { stampUid, stampUids } from './utils/uid';

const ACTIVE_SESSION_KEY = 'lectern_active_session_id';
const SESSION_SPEND_KEY = 'lectern_session_spend';
const BUDGET_LIMIT_KEY = 'lectern_budget_limit';

const getStoredNumber = (key: string, fallback: number): number => {
  if (typeof window === 'undefined') return fallback;
  const stored = localStorage.getItem(key);
  if (stored === null) return fallback;
  const parsed = parseFloat(stored);
  return isNaN(parsed) ? fallback : parsed;
};

const getStored = <T>(key: string, fallback: T): T => {
  if (typeof window === 'undefined') return fallback;
  const stored = localStorage.getItem(key);
  return (stored as T) || fallback;
};

const getGenerationState = () => ({
  step: 'dashboard' as Step,
  pdfFile: null,
  deckName: '',
  focusPrompt: '',
  sourceType: getStored('sourceType', 'auto') as 'auto' | 'slides' | 'script',
  targetDeckSize: 1,
  logs: [],
  progress: { current: 0, total: 0 },
  currentPhase: 'idle' as Phase,
  isError: false,
  isCancelling: false,
  estimation: null,
  isEstimating: false,
  estimationError: null as string | null,
  totalPages: 0,
  setupStepsCompleted: 0,
  conceptProgress: { current: 0, total: 0 },
});

const getSessionState = () => ({
  sessionId: null,
  isHistorical: false,
});

const getReviewState = () => ({
  cards: [],
  editingIndex: null,
  editForm: null,
  isSyncing: false,
  syncSuccess: false,
  syncPartialFailure: null as { failed: number; created: number } | null,
  syncProgress: { current: 0, total: 0 },
  syncLogs: [],
  deletedCards: [] as import('./store-types').DeletedCardBuffer[],
  batchDeletedCards: [] as import('./store-types').DeletedCardBuffer[],
  isMultiSelectMode: false,
  selectedCards: new Set<string>(),
});

const getUiState = () => ({
  confirmModal: { isOpen: false, type: 'lectern' as const, index: -1 },
  searchQuery: '',
  sortBy: getStored<SortOption>('cardSortBy', 'creation'),
  copied: false,
  toasts: [],
});

const getBudgetState = () => ({
  totalSessionSpend: getStoredNumber(SESSION_SPEND_KEY, 0),
  budgetLimit: (() => {
    if (typeof window === 'undefined') return null;
    const stored = localStorage.getItem(BUDGET_LIMIT_KEY);
    if (stored === null || stored === 'null') return null;
    const parsed = parseFloat(stored);
    return isNaN(parsed) ? null : parsed;
  })() as number | null,
});

const getInitialState = (): StoreState => ({
  ...getGenerationState(),
  ...getSessionState(),
  ...getReviewState(),
  ...getUiState(),
  ...getBudgetState(),
});

const processSyncEvent = async (
  event: ProgressEvent,
  set: (fn: (state: StoreState) => Partial<StoreState> | StoreState) => void,
  get: () => LecternStore
) => {
  if (processStreamEvent(event, set, { logKey: 'syncLogs', progressKey: 'syncProgress' })) {
    return;
  }

  if (event.type === 'done') {
    const { isHistorical, sessionId } = get();
    const failed = event.data?.failed || 0;
    const created = event.data?.created || 0;

    try {
      if (isHistorical && sessionId) {
        const session = await api.getSession(sessionId);
        set(() => ({ cards: stampUids(session.cards || []) }));
      } else if (sessionId) {
        const drafts = await api.getDrafts(sessionId);
        set(() => ({ cards: stampUids(drafts.cards || []) }));
      }
    } catch (refreshErr) {
      console.error('Failed to refresh cards after sync:', refreshErr);
    }

    if (failed > 0) {
      // Partial failure: show warning, no success animation
      set(() => ({ syncSuccess: false, syncPartialFailure: { failed, created } }));
      get().addToast('warning', `Sync completed with ${failed} failure(s). Check logs.`, 8000);
    } else {
      // Full success
      set(() => ({ syncSuccess: true, syncPartialFailure: null }));
      get().addToast('success', `Synced ${created} cards to Anki!`);
      setTimeout(() => set(() => ({ syncSuccess: false })), 3000);
    }
  }
};

const setEditSession = (
  set: (state: Partial<StoreState> | ((state: StoreState) => Partial<StoreState>)) => void,
  session: { index: number; form: StoreState['editForm'] } | null
) => {
  if (session) {
    set({ editingIndex: session.index, editForm: session.form });
  } else {
    set({ editingIndex: null, editForm: null });
  }
};

const resolveSessionId = (get: () => LecternStore) => get().sessionId ?? undefined;

const createGenerationActions = (
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
  setSourceType: (type) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('sourceType', type);
    }
    set({ sourceType: type });
  },
  setTargetDeckSize: (target) => {
    const { estimation } = get();
    set({ targetDeckSize: target });

    // Persist preference if we have an estimation context
    if (estimation && typeof window !== 'undefined') {
      const pageCount = estimation.pages || 1;
      const textChars = estimation.text_chars || 0;
      const avgChars = textChars / pageCount;
      const isScript = avgChars > 1500; // SCRIPT_THRESHOLD

      if (isScript) {
        // Preference: cards per 1k chars
        const per1k = (target / textChars) * 1000;
        localStorage.setItem('lectern_pref_cards_per_1k', per1k.toFixed(2));
      } else {
        // Preference: cards per slide
        const perSlide = target / pageCount;
        localStorage.setItem('lectern_pref_cards_per_slide', perSlide.toFixed(2));
      }
    }
  },
  setEstimation: (est) => set({ estimation: est, estimationError: null }),
  setEstimationError: (error) => set({ estimationError: error }),
  setTotalPages: (n) => set({ totalPages: n }),
  recommendTargetDeckSize: (est) => {
    // Auto-set target based on content type
    // Script (>1500 chars/page) -> lower density (0.75 cards/1000 chars)
    // Slides (<400 chars/page) -> higher density (1.5 cards/slide)
    set({ totalPages: est.pages });

    // Only update if not manually set yet (or strictly 'auto')
    if (typeof window !== 'undefined') {
      const pageCount = est.pages || 1;
      const textChars = est.text_chars || 0;
      const avgChars = textChars / pageCount;
      const isScript = avgChars > 1500; // SCRIPT_THRESHOLD

      let preferredTarget: number | null = null;

      if (isScript) {
        const stored = localStorage.getItem('lectern_pref_cards_per_1k');
        if (stored) {
          const per1k = parseFloat(stored);
          if (!isNaN(per1k)) {
            preferredTarget = Math.round((per1k * textChars) / 1000);
          }
        }
      } else {
        const stored = localStorage.getItem('lectern_pref_cards_per_slide');
        if (stored) {
          const perSlide = parseFloat(stored);
          if (!isNaN(perSlide)) {
            preferredTarget = Math.round(perSlide * pageCount);
          }
        }
      }

      if (preferredTarget !== null) {
        // Clamp to min 1
        set({ targetDeckSize: Math.max(1, preferredTarget) });
      } else if (est.suggested_card_count) {
        // Fallback to backend suggestion if no preference
        set({ targetDeckSize: est.suggested_card_count });
      }
    }
  },
  setIsEstimating: (value) => set({ isEstimating: value }),
  setIsError: (value) => set({ isError: value }),
  setIsCancelling: (value) => set({ isCancelling: value }),
  setSessionId: (id) => {
    if (typeof window !== 'undefined') {
      if (id) localStorage.setItem(ACTIVE_SESSION_KEY, id);
      else localStorage.removeItem(ACTIVE_SESSION_KEY);
    }
    set({ sessionId: id });
  },
  setPhaseFromEvent: (event) =>
    set((state) => {
      if (event.type !== 'step_start') return state;
      const data = event.data as { phase?: Phase } | undefined;
      if (data?.phase) {
        return { ...state, currentPhase: data.phase };
      }
      return state;
    }),
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
    if (typeof window !== 'undefined') {
      localStorage.removeItem(ACTIVE_SESSION_KEY);
    }
    set(getInitialState());
  },
  handleGenerate: () => generationLogic.handleGenerate(set, get),
  handleCancel: () => generationLogic.handleCancel(set, get),
  handleReset: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(ACTIVE_SESSION_KEY);
    }
    set(getInitialState());
  },
  handleCopyLogs: () => {
    const { logs } = get();
    const text = logs
      .map(
        (log) =>
          `[${new Date(log.timestamp * 1000).toLocaleTimeString()}] ${log.type.toUpperCase()}: ${log.message}`
      )
      .join('\n');
    navigator.clipboard.writeText(text);
    set({ copied: true });
    get().addToast('success', 'Logs copied to clipboard', 2500);
    setTimeout(() => set({ copied: false }), 2000);
  },
  loadSession: (sessionId) => generationLogic.loadSession(sessionId, set),
  recoverSessionOnRefresh: () => generationLogic.recoverSessionOnRefresh(set),
  refreshRecoveredSession: () => generationLogic.refreshRecoveredSession(set, get),
});

const createReviewActions = (
  set: (state: Partial<StoreState> | ((state: StoreState) => Partial<StoreState>)) => void,
  get: () => LecternStore
): ReviewActions => ({
  setIsHistorical: (value) => set({ isHistorical: value }),
  setConfirmModal: (modal) => set({ confirmModal: modal }),
  setEditingIndex: (index) => set({ editingIndex: index }),
  setEditForm: (card) => set({ editForm: card }),
  setSyncProgress: (progress) => set({ syncProgress: progress }),
  setSyncLogs: (logs) => set({ syncLogs: logs }),
  startEdit: (index) => {
    const { cards } = get();
    setEditSession(set, {
      index,
      form: JSON.parse(JSON.stringify(cards[index])),
    });
  },
  cancelEdit: () => {
    setEditSession(set, null);
  },
  saveEdit: async (index) => {
    const { editForm, cards, isHistorical } = get();
    const sessionId = resolveSessionId(get);
    if (!editForm) return;

    try {
      const newCards = [...cards];
      newCards[index] = editForm;

      if (isHistorical && sessionId) {
        await api.updateSessionCards(sessionId, newCards);
      } else {
        await api.updateDraft(index, editForm, sessionId);
      }

      if (editForm.anki_note_id && editForm.fields) {
        const stringFields: Record<string, string> = {};
        for (const [k, v] of Object.entries(editForm.fields)) {
          stringFields[k] = String(v);
        }
        await api.updateAnkiNote(editForm.anki_note_id, stringFields);
      }

      setEditSession(set, null);
      set({ cards: newCards });
    } catch (e) {
      console.error('Failed to update card', e);
    }
  },
  handleFieldChange: (field, value) => {
    const { editForm } = get();
    if (!editForm) return;
    const currentFields =
      editForm.fields && typeof editForm.fields === 'object' ? editForm.fields : {};
    set({
      editForm: {
        ...editForm,
        fields: {
          ...currentFields,
          [field]: value,
        },
      },
    });
  },
  handleDelete: async (index) => {
    const { cards, isHistorical, deletedCards } = get();
    const sessionId = resolveSessionId(get);
    const card = cards[index];
    if (!card) return;

    try {
      const newCards = [...cards];
      newCards.splice(index, 1);

      if (isHistorical && sessionId) {
        await api.deleteSessionCard(sessionId, index);
      } else {
        await api.deleteDraft(index, sessionId);
      }

      // Add to undo buffer with 30s timeout
      const cardUid = card._uid || '';
      const timeoutId = setTimeout(() => {
        get().clearDeletedCard(cardUid);
      }, 30000);

      const bufferEntry: import('./store-types').DeletedCardBuffer = {
        card,
        originalIndex: index,
        deletedAt: Date.now(),
        timeoutId,
      };

      set((state) => ({
        cards: newCards,
        deletedCards: [...deletedCards, bufferEntry],
        confirmModal: { ...state.confirmModal, isOpen: false },
      }));

      get().addToast(
        'info',
        'Card removed',
        30000,
        () => get().undoDelete(cardUid),
        'Undo'
      );
    } catch (e) {
      console.error('Failed to delete card', e);
      get().addToast('error', 'Failed to delete card');
    }
  },
  undoDelete: async (cardUid: string) => {
    const { deletedCards } = get();
    const entry = deletedCards.find((e) => e.card._uid === cardUid);
    if (!entry) return;

    // Clear the timeout if it exists
    if (entry.timeoutId) {
      clearTimeout(entry.timeoutId);
    }

    const { cards } = get();
    const newCards = [...cards];

    // Restore at original index, or append if invalid
    const insertIndex =
      entry.originalIndex >= 0 && entry.originalIndex <= newCards.length
        ? entry.originalIndex
        : newCards.length;
    newCards.splice(insertIndex, 0, entry.card);

    // Remove from buffer
    set((state) => ({
      cards: newCards,
      deletedCards: state.deletedCards.filter((e) => e.card._uid !== cardUid),
    }));

    // Sync to backend
    const sessionId = resolveSessionId(get);
    const { isHistorical } = get();
    try {
      if (isHistorical && sessionId) {
        await api.updateSessionCards(sessionId, newCards);
      } else {
        await api.updateDrafts(newCards, sessionId);
      }
      get().addToast('success', 'Card restored');
    } catch (e) {
      console.error('Failed to restore card on backend', e);
      get().addToast('error', 'Failed to restore card on server');
    }
  },
  clearDeletedCard: (cardUid: string) => {
    const { deletedCards } = get();
    const entry = deletedCards.find((e) => e.card._uid === cardUid);
    if (!entry) return;

    // Clear timeout if it still exists
    if (entry.timeoutId) {
      clearTimeout(entry.timeoutId);
    }

    // Remove from buffer
    set((state) => ({
      deletedCards: state.deletedCards.filter((e) => e.card._uid !== cardUid),
    }));
  },
  handleAnkiDelete: async (noteId, index) => {
    const { cards, isHistorical } = get();
    const sessionId = resolveSessionId(get);
    try {
      await api.deleteAnkiNotes([noteId]);
      const newCards = [...cards];
      if (newCards[index] && newCards[index].anki_note_id === noteId) {
        delete newCards[index].anki_note_id;
        if (isHistorical && sessionId) {
          await api.updateSessionCards(sessionId, newCards);
        } else {
          await api.updateDraft(index, newCards[index], sessionId);
        }
        set({ cards: newCards });
      }
      set((state) => ({
        confirmModal: { ...state.confirmModal, isOpen: false },
      }));
      get().addToast('warning', 'Note deleted from Anki');
    } catch (e) {
      console.error('Failed to delete Anki note', e);
      get().addToast('error', 'Failed to delete from Anki');
    }
  },
  handleSync: async () => {
    const { isHistorical } = get();
    const sessionId = resolveSessionId(get);
    set({ isSyncing: true, syncSuccess: false, syncLogs: [] });
    try {
      const syncFn =
        isHistorical && sessionId
          ? (cb: (event: ProgressEvent) => void) => api.syncSessionToAnki(sessionId, cb)
          : (cb: (event: ProgressEvent) => void) =>
            api.syncDrafts(cb, sessionId);

      await syncFn((event: ProgressEvent) => processSyncEvent(event, set, get));
    } catch (e) {
      console.error('Sync failed', e);
      get().addToast('error', 'Sync failed');
    } finally {
      set({ isSyncing: false });
    }
  },
});

const createUiActions = (
  set: (state: Partial<StoreState> | ((state: StoreState) => Partial<StoreState>)) => void
): UiActions => ({
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSortBy: (option) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('cardSortBy', option);
    }
    set({ sortBy: option });
  },
});

let toastIdCounter = 0;

const createToastActions = (
  set: (state: Partial<StoreState> | ((state: StoreState) => Partial<StoreState>)) => void
): ToastActions => ({
  addToast: (type, message, duration = 5000, onUndo, undoLabel) => {
    const id = `toast-${++toastIdCounter}-${Date.now()}`;
    set((state) => ({
      toasts: [...state.toasts, { id, type, message, duration, onUndo, undoLabel }],
    }));
    if (duration > 0) {
      setTimeout(() => {
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        }));
      }, duration);
    }
  },
  dismissToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
});

const createProgressTrackingActions = (
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

const createBatchActions = (
  set: (state: Partial<StoreState> | ((state: StoreState) => Partial<StoreState>)) => void,
  get: () => LecternStore
): BatchActions => ({
  toggleMultiSelectMode: () => {
    const { isMultiSelectMode } = get();
    if (isMultiSelectMode) {
      // Turning off: clear selection
      set({ isMultiSelectMode: false, selectedCards: new Set() });
    } else {
      set({ isMultiSelectMode: true });
    }
  },
  toggleCardSelection: (cardUid) => {
    set((state) => {
      const newSet = new Set(state.selectedCards);
      if (newSet.has(cardUid)) {
        newSet.delete(cardUid);
      } else {
        newSet.add(cardUid);
      }
      return { selectedCards: newSet };
    });
  },
  selectAllCards: () => {
    const { cards } = get();
    const allUids = new Set(cards.filter(c => c._uid).map(c => c._uid!));
    set({ selectedCards: allUids });
  },
  clearSelection: () => {
    set({ selectedCards: new Set() });
  },
  batchDeleteSelected: async () => {
    const { cards, selectedCards, batchDeletedCards } = get();
    const sessionId = resolveSessionId(get);

    if (selectedCards.size === 0) return;

    // Build a map of uid -> index for quick lookup
    const uidToIndex = new Map<string, number>();
    cards.forEach((c, i) => {
      if (c._uid) uidToIndex.set(c._uid, i);
    });

    // Get indices to delete (sorted descending so we can splice safely)
    const indicesToDelete = Array.from(selectedCards)
      .map(uid => uidToIndex.get(uid))
      .filter((idx): idx is number => idx !== undefined)
      .sort((a, b) => b - a);

    try {
      if (sessionId) {
        // Use batch delete endpoint for efficiency and atomic operation
        await api.batchDeleteSessionCards(sessionId, indicesToDelete);
      } else {
        // Fallback for no session ID (shouldn't happen in valid state)
        for (const index of indicesToDelete) {
           // This path is likely unreachable if sessionId is required for API
           console.warn('No session ID for batch delete, falling back to sequential draft delete');
           await api.deleteDraft(index);
        }
      }

      // Store deleted cards in buffer for undo
      const deletedCardsBuffer: import('./store-types').DeletedCardBuffer[] = indicesToDelete.map(index => {
        const card = cards[index];
        const timeoutId = setTimeout(() => {
          get().clearBatchDeletedCard(card._uid || '');
        }, 30000);

        return {
          card,
          originalIndex: index,
          deletedAt: Date.now(),
          timeoutId,
        };
      });

      set((state) => ({
        cards: cards.filter((c) => !c._uid || !selectedCards.has(c._uid)),
        selectedCards: new Set(),
        isMultiSelectMode: false,
        batchDeletedCards: [...batchDeletedCards, ...deletedCardsBuffer],
        confirmModal: { ...state.confirmModal, isOpen: false },
      }));

      get().addToast(
        'info',
        `${indicesToDelete.length} card${indicesToDelete.length !== 1 ? 's' : ''} removed`,
        30000,
        () => get().undoBatchDelete(),
        'Undo'
      );
    } catch (e) {
      console.error('Failed to batch delete cards', e);
      get().addToast('error', 'Failed to delete selected cards');
    }
  },
  undoBatchDelete: () => {
    const { batchDeletedCards } = get();
    if (batchDeletedCards.length === 0) return;

    // Clear all timeouts
    batchDeletedCards.forEach(entry => {
      if (entry.timeoutId) {
        clearTimeout(entry.timeoutId);
      }
    });

    // Get current cards
    const { cards } = get();
    const newCards = [...cards];

    // Restore all deleted cards in their original positions
    batchDeletedCards.sort((a, b) => b.originalIndex - a.originalIndex);
    batchDeletedCards.forEach(entry => {
      const insertIndex = entry.originalIndex >= 0 && entry.originalIndex <= newCards.length
        ? entry.originalIndex
        : newCards.length;
      newCards.splice(insertIndex, 0, entry.card);
    });

    set({ cards: newCards, batchDeletedCards: [] });
  },
  clearBatchDeletedCard: (cardUid: string) => {
    set((state) => ({
      batchDeletedCards: state.batchDeletedCards.filter((e) => e.card._uid !== cardUid),
    }));
  },
});

const createBudgetActions = (
  set: (state: Partial<StoreState> | ((state: StoreState) => Partial<StoreState>)) => void,
  get: () => LecternStore
): BudgetActions => ({
  addToSessionSpend: (amount) => {
    const newTotal = get().totalSessionSpend + amount;
    if (typeof window !== 'undefined') {
      localStorage.setItem(SESSION_SPEND_KEY, newTotal.toString());
    }
    set({ totalSessionSpend: newTotal });
  },
  resetSessionSpend: () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(SESSION_SPEND_KEY, '0');
    }
    set({ totalSessionSpend: 0 });
  },
  setBudgetLimit: (limit) => {
    if (typeof window !== 'undefined') {
      if (limit === null) {
        localStorage.removeItem(BUDGET_LIMIT_KEY);
      } else {
        localStorage.setItem(BUDGET_LIMIT_KEY, limit.toString());
      }
    }
    set({ budgetLimit: limit });
  },
  wouldExceedBudget: (amount) => {
    const { budgetLimit, totalSessionSpend } = get();
    if (budgetLimit === null) return false;
    return totalSessionSpend + amount > budgetLimit;
  },
});



export const useLecternStore = create<LecternStore>((set, get) => ({
  ...getInitialState(),
  ...createGenerationActions(set, get),
  ...createReviewActions(set, get),
  ...createUiActions(set),
  ...createToastActions(set),
  ...createProgressTrackingActions(set),
  ...createBatchActions(set, get),
  ...createBudgetActions(set, get),
}));
