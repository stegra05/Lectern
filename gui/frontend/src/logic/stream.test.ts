import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processStreamEvent } from './stream';
import type { ProgressEvent } from '../api';
import type { StoreState } from '../store-types';

type StoreSetter = (fn: (state: StoreState) => Partial<StoreState> | StoreState) => void;
type SetterFn = (state: StoreState) => Partial<StoreState> | StoreState;

// Mock store state factory
function createMockState(overrides: Partial<StoreState> = {}): StoreState {
  return {
    step: 'dashboard',
    pdfFile: null,
    deckName: '',
    focusPrompt: '',
    targetDeckSize: 50,
    densityPreferences: { per1k: null, perSlide: null },
    logs: [],
    cards: [],
    progress: { current: 0, total: 0 },
    currentPhase: 'idle',
    sessionId: null,
    replayCursor: null,
    isError: false,
    isCancelling: false,
    isResuming: false,
    estimation: null,
    isEstimating: false,
    estimationError: null,
    totalPages: 0,
    coverageData: null,
    rubricSummary: null,
    completionOutcome: null,
    isHistorical: false,
    editingIndex: null,
    editForm: null,
    isSyncing: false,
    syncSuccess: false,
    syncPartialFailure: null,
    syncProgress: { current: 0, total: 0 },
    syncLogs: [],
    confirmModal: { isOpen: false, type: 'lectern', index: 0 },
    searchQuery: '',
    sortBy: 'creation',
    isMultiSelectMode: false,
    selectedCards: new Set(),
    lastSelectedUid: null,
    copied: false,
    toasts: [],
    setupStepsCompleted: 0,
    conceptProgress: { current: 0, total: 0 },
    deletedCards: [],
    batchDeletedCards: [],
    totalSessionSpend: 0,
    lastSnapshotTimestamp: null,
    ...overrides,
  };
}

describe('processStreamEvent', () => {
  let mockSet: ReturnType<typeof vi.fn>;
  let mockState: StoreState;

  beforeEach(() => {
    mockSet = vi.fn();
    mockState = createMockState();
  });

  describe('log appending', () => {
    it('appends event to logs when logKey is "logs"', () => {
      const event: ProgressEvent = {
        type: 'status',
        message: 'Test message',
        timestamp: Date.now(),
      };

      processStreamEvent(event, mockSet as unknown as StoreSetter, { logKey: 'logs', progressKey: 'progress' });

      // Find the call that appended to logs
      const logAppendCall = (mockSet.mock.calls as unknown as Array<[SetterFn]>).find(
        (call) => call[0](mockState).logs !== undefined
      );
      expect(logAppendCall).toBeDefined();
      if (!logAppendCall) throw new Error('Expected log append call');
      const result = logAppendCall[0](mockState);
      expect(result.logs).toHaveLength(1);
      expect(result.logs?.[0]).toEqual(event);
    });

    it('appends event to syncLogs when logKey is "syncLogs"', () => {
      const event: ProgressEvent = {
        type: 'status',
        message: 'Sync message',
        timestamp: Date.now(),
      };

      processStreamEvent(event, mockSet as unknown as StoreSetter, { logKey: 'syncLogs', progressKey: 'syncProgress' });

      const logAppendCall = (mockSet.mock.calls as unknown as Array<[SetterFn]>).find(
        (call) => call[0](mockState).syncLogs !== undefined
      );
      expect(logAppendCall).toBeDefined();
      if (!logAppendCall) throw new Error('Expected sync log append call');
      const result = logAppendCall[0](mockState);
      expect(result.syncLogs).toHaveLength(1);
      expect(result.syncLogs?.[0]).toEqual(event);
    });
  });

  describe('progress_start event', () => {
    it('sets progress with total from event data', () => {
      const event: ProgressEvent = {
        type: 'progress_start',
        message: '',
        data: { total: 100 },
        timestamp: Date.now(),
      };

      const result = processStreamEvent(
        event,
        mockSet as unknown as StoreSetter,
        { logKey: 'logs', progressKey: 'progress' }
      );

      expect(result).toBe(true);
      const progressCall = (mockSet.mock.calls as unknown as Array<[SetterFn]>).find(
        (call) => call[0](mockState).progress !== undefined
      );
      expect(progressCall).toBeDefined();
      if (!progressCall) throw new Error('Expected progress call');
      const state = progressCall[0](mockState);
      expect(state.progress).toEqual({ current: 0, total: 100 });
    });

    it('sets syncProgress when progressKey is "syncProgress"', () => {
      const event: ProgressEvent = {
        type: 'progress_start',
        message: '',
        data: { total: 50 },
        timestamp: Date.now(),
      };

      processStreamEvent(event, mockSet as unknown as StoreSetter, {
        logKey: 'syncLogs',
        progressKey: 'syncProgress',
      });

      const progressCall = (mockSet.mock.calls as unknown as Array<[SetterFn]>).find(
        (call) => call[0](mockState).syncProgress !== undefined
      );
      expect(progressCall).toBeDefined();
      if (!progressCall) throw new Error('Expected sync progress call');
      const state = progressCall[0](mockState);
      expect(state.syncProgress).toEqual({ current: 0, total: 50 });
    });

    it('sets conceptProgress when phase is "concept"', () => {
      const event: ProgressEvent = {
        type: 'progress_start',
        message: '',
        data: { total: 20, phase: 'concept' },
        timestamp: Date.now(),
      };

      processStreamEvent(event, mockSet as unknown as StoreSetter, {
        logKey: 'logs',
        progressKey: 'progress',
      });

      const conceptCall = (mockSet.mock.calls as unknown as Array<[SetterFn]>).find(
        (call) => call[0](mockState).conceptProgress !== undefined
      );
      expect(conceptCall).toBeDefined();
      if (!conceptCall) throw new Error('Expected concept progress call');
      const state = conceptCall[0](mockState);
      expect(state.conceptProgress).toEqual({ current: 0, total: 20 });
    });

    it('returns false for invalid progress_start data', () => {
      const event: ProgressEvent = {
        type: 'progress_start',
        message: '',
        data: { invalid: 'data' }, // Missing 'total'
        timestamp: Date.now(),
      };

      const result = processStreamEvent(event, mockSet as unknown as StoreSetter, {
        logKey: 'logs',
        progressKey: 'progress',
      });

      expect(result).toBe(false);
    });
  });

  describe('progress_update event', () => {
    it('updates progress current value', () => {
      const stateWithProgress = createMockState({
        progress: { current: 0, total: 100 },
      });

      const event: ProgressEvent = {
        type: 'progress_update',
        message: '',
        data: { current: 50 },
        timestamp: Date.now(),
      };

      processStreamEvent(event, mockSet as unknown as StoreSetter, {
        logKey: 'logs',
        progressKey: 'progress',
      });

      const progressCall = (mockSet.mock.calls as unknown as Array<[SetterFn]>).find(
        (call) => call[0](stateWithProgress).progress !== undefined
      );
      expect(progressCall).toBeDefined();
      if (!progressCall) throw new Error('Expected progress call');
      const state = progressCall[0](stateWithProgress);
      expect(state.progress).toEqual({ current: 50, total: 100 });
    });

    it('updates progress total when provided', () => {
      const stateWithProgress = createMockState({
        progress: { current: 0, total: 100 },
      });

      const event: ProgressEvent = {
        type: 'progress_update',
        message: '',
        data: { current: 50, total: 200 },
        timestamp: Date.now(),
      };

      processStreamEvent(event, mockSet as unknown as StoreSetter, {
        logKey: 'logs',
        progressKey: 'progress',
      });

      const progressCall = (mockSet.mock.calls as unknown as Array<[SetterFn]>).find(
        (call) => call[0](stateWithProgress).progress !== undefined
      );
      expect(progressCall).toBeDefined();
      if (!progressCall) throw new Error('Expected progress call');
      const state = progressCall[0](stateWithProgress);
      expect(state.progress).toEqual({ current: 50, total: 200 });
    });

    it('updates syncProgress when progressKey is "syncProgress"', () => {
      const stateWithProgress = createMockState({
        syncProgress: { current: 0, total: 30 },
      });

      const event: ProgressEvent = {
        type: 'progress_update',
        message: '',
        data: { current: 10 },
        timestamp: Date.now(),
      };

      processStreamEvent(event, mockSet as unknown as StoreSetter, {
        logKey: 'syncLogs',
        progressKey: 'syncProgress',
      });

      const progressCall = (mockSet.mock.calls as unknown as Array<[SetterFn]>).find(
        (call) => call[0](stateWithProgress).syncProgress !== undefined
      );
      expect(progressCall).toBeDefined();
      if (!progressCall) throw new Error('Expected sync progress call');
      const state = progressCall[0](stateWithProgress);
      expect(state.syncProgress).toEqual({ current: 10, total: 30 });
    });

    it('updates conceptProgress when phase is "concept"', () => {
      const stateWithConcept = createMockState({
        conceptProgress: { current: 0, total: 20 },
      });

      const event: ProgressEvent = {
        type: 'progress_update',
        message: '',
        data: { current: 15, phase: 'concept' },
        timestamp: Date.now(),
      };

      processStreamEvent(event, mockSet as unknown as StoreSetter, {
        logKey: 'logs',
        progressKey: 'progress',
      });

      const conceptCall = (mockSet.mock.calls as unknown as Array<[SetterFn]>).find(
        (call) => call[0](stateWithConcept).conceptProgress !== undefined
      );
      expect(conceptCall).toBeDefined();
      if (!conceptCall) throw new Error('Expected concept progress call');
      const state = conceptCall[0](stateWithConcept);
      expect(state.conceptProgress).toEqual({ current: 15, total: 20 });
    });

    it('returns false for invalid progress_update data', () => {
      const event: ProgressEvent = {
        type: 'progress_update',
        message: '',
        data: { invalid: 'data' }, // Missing 'current'
        timestamp: Date.now(),
      };

      const result = processStreamEvent(event, mockSet as unknown as StoreSetter, {
        logKey: 'logs',
        progressKey: 'progress',
      });

      expect(result).toBe(false);
    });
  });

  describe('other events', () => {
    it('returns false for non-progress events', () => {
      const event: ProgressEvent = {
        type: 'status',
        message: 'Some status',
        timestamp: Date.now(),
      };

      const result = processStreamEvent(event, mockSet as unknown as StoreSetter, {
        logKey: 'logs',
        progressKey: 'progress',
      });

      expect(result).toBe(false);
    });

    it('still appends to log for non-progress events', () => {
      const event: ProgressEvent = {
        type: 'status',
        message: 'Some status',
        timestamp: Date.now(),
      };

      processStreamEvent(event, mockSet as unknown as StoreSetter, { logKey: 'logs', progressKey: 'progress' });

      const logAppendCall = (mockSet.mock.calls as unknown as Array<[SetterFn]>).find(
        (call) => call[0](mockState).logs !== undefined
      );
      expect(logAppendCall).toBeDefined();
      if (!logAppendCall) throw new Error('Expected log append call');
      const result = logAppendCall[0](mockState);
      expect(result.logs).toHaveLength(1);
    });
  });
});
