import type { ProgressEvent } from '../api';
import type { StoreState } from '../store-types';
import { validateProgressStartData, validateProgressUpdateData } from '../schemas/sse';

type StoreSetter = (fn: (state: StoreState) => Partial<StoreState> | StoreState) => void;

type StreamKeys = {
  logKey: 'logs' | 'syncLogs';
  progressKey: 'progress' | 'syncProgress';
};

type ProgressState = { current: number; total: number };

/**
 * Type-safe log append helper.
 * Handles both 'logs' and 'syncLogs' keys without type coercion.
 */
function appendToLog(
  set: StoreSetter,
  key: 'logs' | 'syncLogs',
  event: ProgressEvent
): void {
  if (key === 'logs') {
    set((state) => ({ logs: [...state.logs, event] }));
  } else {
    set((state) => ({ syncLogs: [...state.syncLogs, event] }));
  }
}

/**
 * Type-safe progress setter for progress_start events.
 * Returns a partial state update without type coercion.
 */
function setProgressStart(
  key: 'progress' | 'syncProgress',
  total: number
): Partial<StoreState> {
  if (key === 'progress') {
    return { progress: { current: 0, total } };
  }
  return { syncProgress: { current: 0, total } };
}

/**
 * Type-safe progress updater for progress_update events.
 * Returns a partial state update without type coercion.
 */
function updateProgress(
  state: StoreState,
  key: 'progress' | 'syncProgress',
  current: number,
  total?: number
): Partial<StoreState> {
  if (key === 'progress') {
    return {
      progress: {
        ...state.progress,
        current,
        total: total !== undefined ? total : state.progress.total,
      },
    };
  }
  return {
    syncProgress: {
      ...state.syncProgress,
      current,
      total: total !== undefined ? total : state.syncProgress.total,
    },
  };
}

/**
 * Type-safe concept progress updater.
 */
function updateConceptProgress(
  state: StoreState,
  current: number,
  total?: number
): Partial<StoreState> {
  return {
    conceptProgress: {
      ...state.conceptProgress,
      current,
      total: total !== undefined ? total : state.conceptProgress.total,
    },
  };
}

export const processStreamEvent = (
  event: ProgressEvent,
  set: StoreSetter,
  keys: StreamKeys
): boolean => {
  // Type-safe log append
  appendToLog(set, keys.logKey, event);

  if (event.type === 'progress_start') {
    const data = validateProgressStartData(event.data);
    if (!data) {
      return false;
    }
    set(() => setProgressStart(keys.progressKey, data.total));

    // Handle concept phase progress
    if (data.phase === 'concept') {
      set(() => ({ conceptProgress: { current: 0, total: data.total } }));
    }
    return true;
  }

  if (event.type === 'progress_update') {
    const data = validateProgressUpdateData(event.data);
    if (!data) {
      return false;
    }
    set((state) => updateProgress(state, keys.progressKey, data.current, data.total));

    // Handle concept phase progress
    if (data.phase === 'concept') {
      set((state) => updateConceptProgress(state, data.current, data.total));
    }
    return true;
  }

  return false;
};
