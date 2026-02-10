import { create } from 'zustand';

import { api, type ProgressEvent } from './api';
import type { Phase } from './components/PhaseIndicator';
import type {
  StoreState,
  LecternStore,
  GenerationActions,
  ReviewActions,
  UiActions,
} from './store-types';
import * as generationLogic from './logic/generation';
import { processStreamEvent } from './logic/stream';

const ACTIVE_SESSION_KEY = 'lectern_active_session_id';

const getStored = <T>(key: string, fallback: T): T => {
  if (typeof window === 'undefined') return fallback;
  const stored = localStorage.getItem(key);
  return (stored as T) || fallback;
};

const getGenerationState = () => ({
  step: 'dashboard',
  pdfFile: null,
  deckName: '',
  focusPrompt: '',
  sourceType: getStored('sourceType', 'auto'),
  targetDeckSize: 1,
  logs: [],
  progress: { current: 0, total: 0 },
  currentPhase: 'idle',
  isError: false,
  isCancelling: false,
  estimation: null,
  isEstimating: false,
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
  syncProgress: { current: 0, total: 0 },
  syncLogs: [],
});

const getUiState = () => ({
  confirmModal: { isOpen: false, type: 'lectern', index: -1 },
  searchQuery: '',
  sortBy: getStored('cardSortBy', 'creation'),
  copied: false,
});

const getInitialState = (): StoreState => ({
  ...getGenerationState(),
  ...getSessionState(),
  ...getReviewState(),
  ...getUiState(),
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
    try {
      if (isHistorical && sessionId) {
        const session = await api.getSession(sessionId);
        set(() => ({ cards: session.cards || [] }));
      } else if (sessionId) {
        const drafts = await api.getDrafts(sessionId);
        set(() => ({ cards: drafts.cards || [] }));
      }
    } catch (refreshErr) {
      console.error('Failed to refresh cards after sync:', refreshErr);
    }
    set(() => ({ syncSuccess: true }));
    setTimeout(() => set(() => ({ syncSuccess: false })), 3000);
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
  setPdfFile: (file) => set({ pdfFile: file }),
  setDeckName: (name) => set({ deckName: name }),
  setFocusPrompt: (prompt) => set({ focusPrompt: prompt }),
  setSourceType: (type) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('sourceType', type);
    }
    set({ sourceType: type });
  },
  setTargetDeckSize: (target) => set({ targetDeckSize: target }),
  setEstimation: (est) => set({ estimation: est }),
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
      cards: [...state.cards, card],
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
    const { cards, isHistorical } = get();
    const sessionId = resolveSessionId(get);
    try {
      const newCards = [...cards];
      newCards.splice(index, 1);

      if (isHistorical && sessionId) {
        await api.deleteSessionCard(sessionId, index);
      } else {
        await api.deleteDraft(index, sessionId);
      }

      set((state) => ({
        cards: newCards,
        confirmModal: { ...state.confirmModal, isOpen: false },
      }));
    } catch (e) {
      console.error('Failed to delete card', e);
    }
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
    } catch (e) {
      console.error('Failed to delete Anki note', e);
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

export const useLecternStore = create<LecternStore>((set, get) => ({
  ...getInitialState(),
  ...createGenerationActions(set, get),
  ...createReviewActions(set, get),
  ...createUiActions(set),
}));
