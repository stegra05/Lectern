import type { StoreState, LecternStore, UiActions, ToastActions, BudgetActions } from "../store-types";
import type { SortOption } from "../hooks/types";
import type { StoreToast } from "../store-types";

export const getUiState = () => ({
  confirmModal: { isOpen: false, type: "lectern" as const, index: -1 },
  searchQuery: "",
  sortBy: "creation" as SortOption,
  copied: false,
  toasts: [] as StoreToast[],
});

export const getBudgetState = () => ({
  totalSessionSpend: 0,
  budgetLimit: null as number | null,
});

export const createUiActions = (
  set: (state: Partial<StoreState> | ((state: StoreState) => Partial<StoreState>)) => void
): UiActions => ({
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSortBy: (option) => set({ sortBy: option }),
});

let toastIdCounter = 0;

export const createToastActions = (
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

export const createBudgetActions = (
  set: (state: Partial<StoreState> | ((state: StoreState) => Partial<StoreState>)) => void,
  get: () => LecternStore
): BudgetActions => ({
  addToSessionSpend: (amount) => {
    const newTotal = get().totalSessionSpend + amount;
    set({ totalSessionSpend: newTotal });
  },
  resetSessionSpend: () => {
    set({ totalSessionSpend: 0 });
  },
  setBudgetLimit: (limit) => {
    set({ budgetLimit: limit });
  },
  wouldExceedBudget: (amount) => {
    const { budgetLimit, totalSessionSpend } = get();
    if (budgetLimit === null) return false;
    return totalSessionSpend + amount > budgetLimit;
  },
});



