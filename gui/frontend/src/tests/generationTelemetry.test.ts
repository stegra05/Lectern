import { beforeEach, describe, expect, it, vi } from 'vitest';

const telemetrySpies = vi.hoisted(() => ({
  markPerf: vi.fn(),
  measurePerf: vi.fn(),
  flushPerfTelemetry: vi.fn(),
}));

const apiSpies = vi.hoisted(() => ({
  generateV2: vi.fn(),
  getSession: vi.fn(),
}));

const storeRuntime = vi.hoisted(() => ({
  getState: vi.fn(),
}));

vi.mock('../lib/perfTelemetry', () => ({
  markPerf: (...args: unknown[]) => telemetrySpies.markPerf(...args),
  measurePerf: (...args: unknown[]) => telemetrySpies.measurePerf(...args),
}));

vi.mock('../lib/perfMetricsClient', () => ({
  flushPerfTelemetry: (payload: unknown) => telemetrySpies.flushPerfTelemetry(payload),
}));

vi.mock('../api', () => ({
  api: {
    generateV2: (...args: unknown[]) => apiSpies.generateV2(...args),
    getSession: (...args: unknown[]) => apiSpies.getSession(...args),
    stopGeneration: vi.fn(),
  },
}));

vi.mock('../store', () => ({
  useLecternStore: {
    getState: () => storeRuntime.getState(),
  },
}));

import { handleGenerate, resolveGenerationMeasurementStartMark } from '../logic/generation';

describe('generation telemetry mark selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses session-specific start mark when session id is available', () => {
    expect(
      resolveGenerationMeasurementStartMark('generation_start:generation:100', 'session-123')
    ).toBe('generation_start:session-123');
  });

  it('falls back to generated mark when session id is missing', () => {
    expect(
      resolveGenerationMeasurementStartMark('generation_start:generation:100', null)
    ).toBe('generation_start:generation:100');
  });

  it('uses fallback start mark on network error before session start', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(12345);

    type State = {
      pdfFile: File | null;
      deckName: string;
      focusPrompt: string;
      targetDeckSize: number;
      step: string;
      logs: unknown[];
      cards: unknown[];
      progress: { current: number; total: number };
      sessionId: string | null;
      replayCursor: number | null;
      isError: boolean;
      isCancelling: boolean;
      isResuming: boolean;
      isHistorical: boolean;
      currentPhase: string;
      setupStepsCompleted: number;
      coverageData: unknown;
      rubricSummary: unknown;
      completionOutcome: unknown;
      lastSnapshotTimestamp: number | null;
      totalPages: number;
      estimation: {
        text_chars?: number;
        model?: string;
        document_type?: string;
        image_count?: number;
      } | null;
    };

    const state: State = {
      pdfFile: new File(['pdf'], 'deck.pdf', { type: 'application/pdf' }),
      deckName: 'Deck',
      focusPrompt: '',
      targetDeckSize: 20,
      step: 'dashboard',
      logs: [],
      cards: [],
      progress: { current: 0, total: 0 },
      sessionId: null,
      replayCursor: null,
      isError: false,
      isCancelling: false,
      isResuming: false,
      isHistorical: false,
      currentPhase: 'starting',
      setupStepsCompleted: 0,
      coverageData: null,
      rubricSummary: null,
      completionOutcome: null,
      lastSnapshotTimestamp: null,
      totalPages: 0,
      estimation: null,
    };

    storeRuntime.getState.mockReturnValue({
      sessionId: state.sessionId,
      step: state.step,
      incrementSetupStep: vi.fn(),
      addToast: vi.fn(),
      addToSessionSpend: vi.fn(),
      cards: state.cards,
      targetDeckSize: state.targetDeckSize,
      totalPages: state.totalPages,
      estimation: state.estimation,
    });

    const set = (partial: Partial<State> | ((s: State) => Partial<State>)) => {
      const update = typeof partial === 'function' ? partial(state) : partial;
      Object.assign(state, update);
      storeRuntime.getState.mockReturnValue({
        sessionId: state.sessionId,
        step: state.step,
        incrementSetupStep: vi.fn(),
        addToast: vi.fn(),
        addToSessionSpend: vi.fn(),
        cards: state.cards,
        targetDeckSize: state.targetDeckSize,
        totalPages: state.totalPages,
        estimation: state.estimation,
      });
    };
    const get = () => state as unknown as Parameters<typeof handleGenerate>[1] extends () => infer T ? T : never;

    apiSpies.generateV2.mockRejectedValue(new Error('disconnect'));

    await handleGenerate(set as never, get as never);

    expect(telemetrySpies.measurePerf).toHaveBeenCalledWith(
      'generation_total_duration',
      'generation_start:generation:12345'
    );
    expect(telemetrySpies.flushPerfTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'generation',
        clearMarks: ['generation_start:generation:12345'],
      })
    );
  });

  it('uses session start mark on disconnect after session is established', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(777);

    type State = {
      pdfFile: File | null;
      deckName: string;
      focusPrompt: string;
      targetDeckSize: number;
      step: string;
      logs: unknown[];
      cards: unknown[];
      progress: { current: number; total: number };
      sessionId: string | null;
      replayCursor: number | null;
      isError: boolean;
      isCancelling: boolean;
      isResuming: boolean;
      isHistorical: boolean;
      currentPhase: string;
      setupStepsCompleted: number;
      coverageData: unknown;
      rubricSummary: unknown;
      completionOutcome: unknown;
      lastSnapshotTimestamp: number | null;
      totalPages: number;
      estimation: {
        text_chars?: number;
        model?: string;
        document_type?: string;
        image_count?: number;
      } | null;
    };

    const state: State = {
      pdfFile: new File(['pdf'], 'deck.pdf', { type: 'application/pdf' }),
      deckName: 'Deck',
      focusPrompt: '',
      targetDeckSize: 20,
      step: 'dashboard',
      logs: [],
      cards: [],
      progress: { current: 0, total: 0 },
      sessionId: null,
      replayCursor: null,
      isError: false,
      isCancelling: false,
      isResuming: false,
      isHistorical: false,
      currentPhase: 'starting',
      setupStepsCompleted: 0,
      coverageData: null,
      rubricSummary: null,
      completionOutcome: null,
      lastSnapshotTimestamp: null,
      totalPages: 0,
      estimation: null,
    };

    storeRuntime.getState.mockReturnValue({
      sessionId: state.sessionId,
      step: state.step,
      incrementSetupStep: vi.fn(),
      addToast: vi.fn(),
      addToSessionSpend: vi.fn(),
      cards: state.cards,
      targetDeckSize: state.targetDeckSize,
      totalPages: state.totalPages,
      estimation: state.estimation,
    });

    const set = (partial: Partial<State> | ((s: State) => Partial<State>)) => {
      const update = typeof partial === 'function' ? partial(state) : partial;
      Object.assign(state, update);
      storeRuntime.getState.mockReturnValue({
        sessionId: state.sessionId,
        step: state.step,
        incrementSetupStep: vi.fn(),
        addToast: vi.fn(),
        addToSessionSpend: vi.fn(),
        cards: state.cards,
        targetDeckSize: state.targetDeckSize,
        totalPages: state.totalPages,
        estimation: state.estimation,
      });
    };
    const get = () => state as unknown as Parameters<typeof handleGenerate>[1] extends () => infer T ? T : never;

    apiSpies.generateV2.mockImplementation(async (_request: unknown, onEvent: (event: unknown) => void) => {
      onEvent({
        event_version: 2,
        session_id: 'session-xyz',
        sequence_no: 1,
        type: 'session_started',
        message: 'started',
        timestamp: 1,
      });
      throw new Error('disconnect');
    });

    await handleGenerate(set as never, get as never);

    expect(telemetrySpies.measurePerf).toHaveBeenCalledWith(
      'generation_total_duration',
      'generation_start:session-xyz'
    );
    expect(telemetrySpies.flushPerfTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-xyz',
        clearMarks: ['generation_start:session-xyz'],
      })
    );
  });
});
