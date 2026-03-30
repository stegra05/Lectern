import { api } from '../api';
import {
  buildClientMetricsPayload,
  type ClientMetricComplexityPayload,
} from './perfTelemetry';

interface FlushPerfTelemetryOptions {
  sessionId: string;
  complexity?: ClientMetricComplexityPayload;
  clearMeasures?: boolean;
}

export const flushPerfTelemetry = async ({
  sessionId,
  complexity,
  clearMeasures = true,
}: FlushPerfTelemetryOptions): Promise<void> => {
  const payload = buildClientMetricsPayload({
    sessionId,
    complexity: complexity ?? {},
  });
  if (!payload) return;

  try {
    await api.postClientMetrics(payload);
    if (clearMeasures && typeof performance.clearMeasures === 'function') {
      performance.clearMeasures();
    }
  } catch (error) {
    console.warn('[Telemetry] Failed to export client metrics', error);
  }
};
