import { describe, expect, it } from 'vitest';

import { resolveGenerationMeasurementStartMark } from '../logic/generation';

describe('generation telemetry mark selection', () => {
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
});
