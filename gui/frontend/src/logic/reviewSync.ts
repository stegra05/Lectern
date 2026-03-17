import type { ProgressEvent } from "../api";
import type { LecternStore, StoreState } from "../store-types";
import { processStreamEvent } from "./stream";
import { reconcileCardUids } from "../utils/uid";
import { normalizeCardsMetadata } from "../utils/cardMetadata";
import { validateSyncDoneData } from "../schemas/sse";

export const processSyncEvent = (
  event: ProgressEvent,
  set: (fn: (state: StoreState) => Partial<StoreState> | StoreState) => void,
  get: () => LecternStore
) => {
  if (processStreamEvent(event, set, { logKey: 'syncLogs', progressKey: 'syncProgress' })) {
    return;
  }

  if (event.type === 'done') {
    const data = validateSyncDoneData(event.data) ?? {};
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
      set(() => ({ syncSuccess: false, syncPartialFailure: { failed, created } }));
      get().addToast('warning', `Sync completed with ${failed} failure(s). Check logs.`, 8000);
    } else {
      set(() => ({ syncSuccess: true, syncPartialFailure: null }));
      get().addToast('success', `Synced ${created} cards to Anki!`);
      setTimeout(() => set(() => ({ syncSuccess: false })), 3000);
    }
  }
};
