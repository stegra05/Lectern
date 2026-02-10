import { create } from 'zustand';

import { api, type ProgressEvent, type Card } from './api';
import type { Phase } from './components/PhaseIndicator';
import type {
  StoreState,
  LecternStore,
  GenerationActions,
  ReviewActions,
  UiActions,
  ConfirmModalState,
} from './store-types';
import * as generationLogic from './logic/generation';

const ACTIVE_SESSION_KEY = 'lectern_active_session_id';

const getStored = <T>(key: string, fallback: T): T => {
  if (typeof window === 'undefined') return fallback;
  const stored = localStorage.getItem(key);
  return (stored as T) || fallback;
};

const getStoredNumber = (key: string, fallback: number): number => {
  if (typeof window === 'undefined') return fallback;
  const stored = localStorage.getItem(key);
  return stored ? Number.parseFloat(stored) : fallback;
};

const getInitialState = (): StoreState => ({
  step: 'dashboard',
  pdfFile: null,
  deckName: '',
  focusPrompt: '',
  sourceType: getStored('sourceType', 'auto'),
  densityTarget: getStoredNumber('densityTarget', 1.5),
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
  sortBy: getStored('cardSortBy', 'creation'),
  copied: false,
});

const processSyncEvent = async (
  event: ProgressEvent,
  set: (fn: (state: StoreState) => Partial<StoreState> | StoreState) => void,
  get: () => LecternStore
) => {
  set((state) => ({ syncLogs: [...state.syncLogs, event] }));

  if (event.type === 'progress_start') {
    set(() => ({ syncProgress: { current: 0, total: (event.data as { total: number }).total } }));
    return;
  }

  if (event.type === 'progress_update') {
    set((state) => ({
      syncProgress: {
        ...state.syncProgress,
        current: (event.data as { current: number }).current,
      },
    }));
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
  setDensityTarget: (target) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('densityTarget', String(target));
    }
    set({ densityTarget: target });
  },
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
    set({
      editingIndex: index,
      editForm: JSON.parse(JSON.stringify(cards[index])),
    });
  },
  cancelEdit: () => {
    set({ editingIndex: null, editForm: null });
  },
  saveEdit: async (index) => {
    const { editForm, cards, isHistorical, sessionId } = get();
    if (!editForm) return;

    try {
      const newCards = [...cards];
      newCards[index] = editForm;

      if (isHistorical && sessionId) {
        await api.updateSessionCards(sessionId, newCards);
      } else {
        await api.updateDraft(index, editForm, sessionId ?? undefined);
      }

      if (editForm.anki_note_id && editForm.fields) {
        const stringFields: Record<string, string> = {};
        for (const [k, v] of Object.entries(editForm.fields)) {
          stringFields[k] = String(v);
        }
        await api.updateAnkiNote(editForm.anki_note_id, stringFields);
      }

      set({ cards: newCards, editingIndex: null, editForm: null });
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
    const { cards, isHistorical, sessionId } = get();
    try {
      const newCards = [...cards];
      newCards.splice(index, 1);

      if (isHistorical && sessionId) {
        await api.deleteSessionCard(sessionId, index);
      } else {
        await api.deleteDraft(index, sessionId ?? undefined);
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
    const { cards, isHistorical, sessionId } = get();
    try {
      await api.deleteAnkiNotes([noteId]);
      const newCards = [...cards];
      if (newCards[index] && newCards[index].anki_note_id === noteId) {
        delete newCards[index].anki_note_id;
        if (isHistorical && sessionId) {
          await api.updateSessionCards(sessionId, newCards);
        } else {
          await api.updateDraft(index, newCards[index], sessionId ?? undefined);
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
    const { isHistorical, sessionId } = get();
    set({ isSyncing: true, syncSuccess: false, syncLogs: [] });
    try {
      const syncFn =
        isHistorical && sessionId
          ? (cb: (event: ProgressEvent) => void) => api.syncSessionToAnki(sessionId, cb)
          : (cb: (event: ProgressEvent) => void) =>
            api.syncDrafts(cb, sessionId ?? undefined);

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
