import { api } from '../api';
import {
  buildClientMetricsPayload,
  getPayloadMeasureNames,
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
      for (const metricName of getPayloadMeasureNames(payload)) {
        performance.clearMeasures(metricName);
      }
    }
  } catch (error) {
    console.warn('[Telemetry] Failed to export client metrics', error);
  }
};
