import type { ProgressEvent } from "../api";
import type { StoreState, LecternStore, ReviewActions, BatchActions } from "../store-types";

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
  saveEdit: (index) => {
    const { editForm, cards } = get();
    if (!editForm) return;

    const newCards = [...cards];
    newCards[index] = editForm;
    setEditSession(set, null);
    set({ cards: newCards });
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
    const { cards } = get();
    const card = cards[index];
    if (!card) return;

    try {
      const newCards = [...cards];
      newCards.splice(index, 1);

      // Add to undo buffer with 30s timeout
      const cardUid = card._uid || '';
      const timeoutId =
        cardUid
          ? setTimeout(() => {
              get().clearDeletedCard(cardUid);
            }, 30000)
          : null;

      const bufferEntry: import('../store-types').DeletedCardBuffer = {
        card,
        originalIndex: index,
        deletedAt: Date.now(),
        timeoutId,
      };

      set((state) => ({
        cards: newCards,
        deletedCards: [...state.deletedCards, bufferEntry],
        confirmModal: { ...state.confirmModal, isOpen: false },
      }));

      get().addToast(
        'info',
        'Card removed',
        30000,
        cardUid ? () => get().undoDelete(cardUid) : undefined,
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
  handleAnkiDelete: (noteId, index) => {
    const { cards } = get();
    const newCards = [...cards];
    if (newCards[index] && newCards[index].anki_note_id === noteId) {
      delete newCards[index].anki_note_id;
    }
    set((state) => ({
      cards: newCards,
      confirmModal: { ...state.confirmModal, isOpen: false },
    }));
  },
  startSync: () => {
    set({ isSyncing: true, syncSuccess: false, syncLogs: [] });
  },
  finishSync: () => {
    set({ isSyncing: false });
  },
  dismissSyncSuccess: () => set({ syncSuccess: false }),
  dismissSyncPartialFailure: () => set({ syncPartialFailure: null }),
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
    const { cards, selectedCards } = get();

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
      const deletedCardsBuffer: import('../store-types').DeletedCardBuffer[] = indicesToDelete.map(index => {
        const card = cards[index];
        const cardUid = card._uid || '';
        const timeoutId =
          cardUid
            ? setTimeout(() => {
                get().clearBatchDeletedCard(cardUid);
              }, 30000)
            : null;

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
        batchDeletedCards: [...state.batchDeletedCards, ...deletedCardsBuffer],
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
    const sorted = [...batchDeletedCards].sort((a, b) => b.originalIndex - a.originalIndex);
    sorted.forEach(entry => {
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

