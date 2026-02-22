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
    const data = event.data as { total: number; phase?: string };
    set(() => ({
      [keys.progressKey]: { current: 0, total: data.total },
    }) as Partial<StoreState>);

    // Handle concept phase progress
    if (data.phase === 'concept') {
      set(() => ({
        conceptProgress: { current: 0, total: data.total },
      }) as Partial<StoreState>);
    }
    return true;
  }

  if (event.type === 'progress_update') {
    const data = event.data as { current: number; total?: number; phase?: string };
    set((state) => ({
      [keys.progressKey]: {
        ...state[keys.progressKey],
        current: data.current,
        total: data.total !== undefined ? data.total : state[keys.progressKey].total,
      },
    }) as Partial<StoreState>);

    // Handle concept phase progress
    if (data.phase === 'concept') {
      set((state) => ({
        conceptProgress: {
          ...state.conceptProgress,
          current: data.current,
          total: data.total !== undefined ? data.total : state.conceptProgress.total,
        },
      }) as Partial<StoreState>);
    }
    return true;
  }

  return false;
};
