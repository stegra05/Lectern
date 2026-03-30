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
  metricNames?: readonly string[];
  clearMarks?: readonly string[];
}

export const flushPerfTelemetry = async ({
  sessionId,
  complexity,
  clearMeasures = true,
  metricNames,
  clearMarks,
}: FlushPerfTelemetryOptions): Promise<void> => {
  const payload = buildClientMetricsPayload({
    sessionId,
    complexity: complexity ?? {},
    metricNames,
  });
  if (!payload) return;

  try {
    await api.postClientMetrics(payload);
    if (clearMeasures && typeof performance.clearMeasures === 'function') {
      for (const metricName of getPayloadMeasureNames(payload)) {
        performance.clearMeasures(metricName);
      }
    }
    if (clearMarks && typeof performance.clearMarks === 'function') {
      for (const markName of clearMarks) {
        performance.clearMarks(markName);
      }
    }
  } catch (error) {
    console.warn('[Telemetry] Failed to export client metrics', error);
  }
};
