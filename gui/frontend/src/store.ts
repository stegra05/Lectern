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
import { clearActiveSessionId, setActiveSessionId } from "./logic/activeSessionStorage";

const getInitialState = (): StoreState => ({
  ...getGenerationState(),
  ...getSessionState(),
  ...getReviewState(),
  ...getUiState(),
  ...getBudgetState(),
});

const persistedKeys = [
  "sortBy",
  "sessionId",
  "totalSessionSpend",
  "deckName",
  "densityPreferences",
] as const satisfies readonly (keyof StoreState)[];

type PersistedState = Pick<StoreState, (typeof persistedKeys)[number]>;

const partializePersistedState = (state: LecternStore): PersistedState => {
  return Object.fromEntries(
    persistedKeys.map((key) => [key, state[key]])
  ) as PersistedState;
};

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
      partialize: partializePersistedState,
    }
  )
);

let previousSessionId = useLecternStore.getState().sessionId;
let previousStep = useLecternStore.getState().step;

useLecternStore.subscribe((state) => {
  const { sessionId, step } = state;
  if (sessionId === previousSessionId && step === previousStep) {
    return;
  }
  previousSessionId = sessionId;
  previousStep = step;

  if (step === "generating" && sessionId) {
    setActiveSessionId(sessionId);
    return;
  }
  clearActiveSessionId();
});
