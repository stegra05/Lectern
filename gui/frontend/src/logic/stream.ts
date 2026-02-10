import type { ProgressEvent } from '../api';
import type { StoreState } from '../store-types';

type StoreSetter = (fn: (state: StoreState) => Partial<StoreState> | StoreState) => void;

type StreamKeys = {
  logKey: 'logs' | 'syncLogs';
  progressKey: 'progress' | 'syncProgress';
};

export const processStreamEvent = (
  event: ProgressEvent,
  set: StoreSetter,
  keys: StreamKeys
): boolean => {
  set((state) => ({
    [keys.logKey]: [...state[keys.logKey], event],
  }) as Partial<StoreState>);

  if (event.type === 'progress_start') {
    set(() => ({
      [keys.progressKey]: { current: 0, total: (event.data as { total: number }).total },
    }) as Partial<StoreState>);
    return true;
  }

  if (event.type === 'progress_update') {
    set((state) => ({
      [keys.progressKey]: {
        ...state[keys.progressKey],
        current: (event.data as { current: number }).current,
      },
    }) as Partial<StoreState>);
    return true;
  }

  return false;
};
