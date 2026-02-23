import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { StoreState, LecternStore } from "./store-types";

import {
  getGenerationState,
  getSessionState,
  createGenerationActions,
  createProgressTrackingActions,
} from "./slices/generationSlice";

import {
  getReviewState,
  createReviewActions,
  createBatchActions,
} from "./slices/reviewSlice";

import {
  getUiState,
  getBudgetState,
  createUiActions,
  createToastActions,
  createBudgetActions,
} from "./slices/uiSlice";

const getInitialState = (): StoreState => ({
  ...getGenerationState(),
  ...getSessionState(),
  ...getReviewState(),
  ...getUiState(),
  ...getBudgetState(),
});

export const useLecternStore = create<LecternStore>()(
  persist(
    (set, get) => ({
      ...getInitialState(),
      ...createGenerationActions(getInitialState, set, get),
      ...createReviewActions(set, get),
      ...createUiActions(set),
      ...createToastActions(set),
      ...createProgressTrackingActions(set),
      ...createBatchActions(set, get),
      ...createBudgetActions(set, get),
    }),
    {
      name: "lectern-storage",
      partialize: (state) => ({
        sourceType: state.sourceType,
        sortBy: state.sortBy,
        sessionId: state.sessionId,
        totalSessionSpend: state.totalSessionSpend,
        budgetLimit: state.budgetLimit,
        deckName: state.deckName,
        availableDecks: state.availableDecks,
        densityPreferences: state.densityPreferences,
      }),
    }
  )
);
