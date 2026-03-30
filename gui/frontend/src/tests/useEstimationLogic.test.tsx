import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useEstimationLogic } from '../hooks/useEstimationLogic';

const mockUseEstimationQuery = vi.fn();
const markPerfMock = vi.fn();
const measurePerfMock = vi.fn();
const flushPerfTelemetryMock = vi.fn();

const storeActions = {
  setIsEstimating: vi.fn(),
  setEstimation: vi.fn(),
  setEstimationError: vi.fn(),
  recommendTargetDeckSize: vi.fn(),
};

const storeState = {
  pdfFile: new File(['pdf'], 'slides.pdf', {
    type: 'application/pdf',
    lastModified: 1700000000000,
  }),
  targetDeckSize: 12,
  estimation: null,
  ...storeActions,
};

vi.mock('../queries', () => ({
  useEstimationQuery: (args: unknown) => mockUseEstimationQuery(args),
}));

vi.mock('../store', () => ({
  useLecternStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
}));

vi.mock('../lib/perfTelemetry', () => ({
  markPerf: (name: string) => markPerfMock(name),
  measurePerf: (...args: unknown[]) => measurePerfMock(...args),
}));

vi.mock('../lib/perfMetricsClient', () => ({
  flushPerfTelemetry: (args: unknown) => flushPerfTelemetryMock(args),
}));

function Harness() {
  useEstimationLogic({
    anki_connected: true,
    gemini_configured: true,
    gemini_model: 'gemini-2.5-flash',
  });
  return null;
}

describe('useEstimationLogic telemetry marking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState.targetDeckSize = 12;
    storeState.estimation = null;
  });

  it('marks estimate start only once while the same request is still loading', () => {
    mockUseEstimationQuery.mockReturnValue({
      data: null,
      error: null,
      isLoading: true,
      isFetching: false,
      dataUpdatedAt: 0,
    });

    const { rerender } = render(<Harness />);
    expect(markPerfMock).toHaveBeenCalledTimes(1);

    storeState.targetDeckSize = 18;
    rerender(<Harness />);

    expect(markPerfMock).toHaveBeenCalledTimes(1);
  });
});
