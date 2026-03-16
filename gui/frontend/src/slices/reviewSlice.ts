import { api, type ProgressEvent } from "../api";
import type { StoreState, LecternStore, ReviewActions, BatchActions } from "../store-types";
import { processStreamEvent } from "../logic/stream";
import { reconcileCardUids } from "../utils/uid";
import { normalizeCardsMetadata } from "../utils/cardMetadata";

export const getReviewState = () => ({
  cards: [] as import("../api").Card[],
  editingIndex: null as number | null,
  editForm: null as import("../api").Card | null,
  isSyncing: false,
  syncSuccess: false,
  syncPartialFailure: null as { failed: number; created: number } | null,
  syncProgress: { current: 0, total: 0 },
  syncLogs: [] as ProgressEvent[],
  deletedCards: [] as import("../store-types").DeletedCardBuffer[],
  batchDeletedCards: [] as import("../store-types").DeletedCardBuffer[],
  isMultiSelectMode: false,
  selectedCards: new Set<string>(),
  lastSelectedUid: null as string | null,
});

export const processSyncEvent = async (
  event: ProgressEvent,
  set: (fn: (state: StoreState) => Partial<StoreState> | StoreState) => void,
  get: () => LecternStore
) => {
  if (processStreamEvent(event, set, { logKey: 'syncLogs', progressKey: 'syncProgress' })) {
    return;
  }

  if (event.type === 'done') {
    const data = (event.data || {}) as { failed?: number; created?: number; cards?: import("../api").Card[] };
    const failed = data.failed || 0;
    const created = data.created || 0;

    if (data.cards) {
      const existingCards = get().cards;
      const normalized = normalizeCardsMetadata(data.cards);
      set(() => ({
        cards: reconcileCardUids(existingCards, normalized),
      }));
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

export const setEditSession = (
  set: (state: Partial<StoreState> | ((state: StoreState) => Partial<StoreState>)) => void,
  session: { index: number; form: StoreState['editForm'] } | null
) => {
  if (session) {
    set({ editingIndex: session.index, editForm: session.form });
  } else {
    set({ editingIndex: null, editForm: null });
  }
};


export const createReviewActions = (
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
      form: structuredClone(cards[index]),
    });
  },
  cancelEdit: () => {
    setEditSession(set, null);
  },
  saveEdit: async (index) => {
    const { editForm, cards } = get();
    if (!editForm) return;

    try {
      const newCards = [...cards];
      newCards[index] = editForm;

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
    const { cards, deletedCards } = get();
    const card = cards[index];
    if (!card) return;

    try {
      const newCards = [...cards];
      newCards.splice(index, 1);

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

    get().addToast('success', 'Card restored');
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
    const { cards } = get();
    try {
      await api.deleteAnkiNotes([noteId]);
      const newCards = [...cards];
      if (newCards[index] && newCards[index].anki_note_id === noteId) {
        delete newCards[index].anki_note_id;
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
    const { cards, deckName } = get();
    set({ isSyncing: true, syncSuccess: false, syncLogs: [] });
    try {
      await api.syncCardsToAnki(
        { cards, deck_name: deckName, tags: [], slide_set_name: deckName, allow_updates: true },
        (event: ProgressEvent) => processSyncEvent(event, set, get)
      );
    } catch (e) {
      console.error('Sync failed', e);
      get().addToast('error', 'Sync failed');
    } finally {
      set({ isSyncing: false });
    }
  },
});

export const createBatchActions = (
  set: (state: Partial<StoreState> | ((state: StoreState) => Partial<StoreState>)) => void,
  get: () => LecternStore
): BatchActions => ({
  toggleMultiSelectMode: () => {
    const { isMultiSelectMode } = get();
    if (isMultiSelectMode) {
      // Turning off: clear selection
      set({ isMultiSelectMode: false, selectedCards: new Set(), lastSelectedUid: null });
    } else {
      set({ isMultiSelectMode: true });
    }
  },
  toggleCardSelection: (cardUid) => {
    set((state) => {
      const newSet = new Set(state.selectedCards);
      if (newSet.has(cardUid)) {
        newSet.delete(cardUid);
        return { selectedCards: newSet, lastSelectedUid: cardUid };
      } else {
        newSet.add(cardUid);
        return { selectedCards: newSet, lastSelectedUid: cardUid };
      }
    });
  },
  selectCardRange: (currentUid) => {
    const { cards, lastSelectedUid } = get();
    if (!lastSelectedUid) {
      // No previous selection, just toggle
      set((state) => {
        const newSet = new Set(state.selectedCards);
        newSet.add(currentUid);
        return { selectedCards: newSet, lastSelectedUid: currentUid };
      });
      return;
    }

    // Find indices of last and current
    const lastIndex = cards.findIndex(c => c._uid === lastSelectedUid);
    const currentIndex = cards.findIndex(c => c._uid === currentUid);

    if (lastIndex === -1 || currentIndex === -1) {
      // Fallback: just toggle current
      set((state) => {
        const newSet = new Set(state.selectedCards);
        newSet.add(currentUid);
        return { selectedCards: newSet, lastSelectedUid: currentUid };
      });
      return;
    }

    // Select range
    const start = Math.min(lastIndex, currentIndex);
    const end = Math.max(lastIndex, currentIndex);

    set((state) => {
      const newSet = new Set(state.selectedCards);
      for (let i = start; i <= end; i++) {
        const uid = cards[i]._uid;
        if (uid) newSet.add(uid);
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
    set({ selectedCards: new Set(), lastSelectedUid: null });
  },
  batchDeleteSelected: async () => {
    const { cards, selectedCards, batchDeletedCards } = get();

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

