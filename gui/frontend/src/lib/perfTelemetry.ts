export interface ClientMetricComplexityPayload {
  card_count?: number;
  target_card_count?: number;
  total_pages?: number;
  text_chars?: number;
  chars_per_page?: number;
  model?: string;
  build_version?: string;
  build_channel?: string;
  document_type?: string;
  image_count?: number;
}

export interface ClientMetricEntryPayload {
  metric_name: string;
  duration_ms: number;
  complexity: ClientMetricComplexityPayload;
}

export interface ClientMetricsPayload {
  client_ts_ms: number;
  session_id: string;
  entries: ClientMetricEntryPayload[];
}

interface BuildClientMetricsPayloadOptions {
  sessionId: string;
  complexity: ClientMetricComplexityPayload;
  clientTsMs?: number;
  metricNames?: readonly string[];
}

const OWNED_MEASURE_PREFIXES = ['generation_', 'estimate_'] as const;

type RuntimeWindow = Window &
  typeof globalThis & {
    __LECTERN_VERSION__?: string;
    __LECTERN_CHANNEL__?: string;
    __LECTERN_BUILD__?: {
      version?: string;
      channel?: string;
    };
  };

const isFiniteNonNegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const normalizeString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeMetric = (value: unknown): number | undefined => {
  if (!isFiniteNonNegative(value)) return undefined;
  return value;
};

const hasOwnedMeasurePrefix = (name: string): boolean =>
  OWNED_MEASURE_PREFIXES.some((prefix) => name.startsWith(prefix));

const hasMark = (markName: string): boolean => {
  if (
    typeof performance === 'undefined' ||
    typeof performance.getEntriesByName !== 'function'
  ) {
    return false;
  }
  return performance.getEntriesByName(markName, 'mark').length > 0;
};

export const markPerf = (name: string): void => {
  const markName = normalizeString(name);
  if (!markName) return;
  if (typeof performance === 'undefined' || typeof performance.mark !== 'function') {
    return;
  }
  if (hasMark(markName)) {
    return;
  }
  performance.mark(markName);
};

export const measurePerf = (
  name: string,
  startMark: string,
  endMark?: string
): boolean => {
  const metricName = normalizeString(name);
  const start = normalizeString(startMark);
  const end = normalizeString(endMark);
  if (!metricName || !start) return false;
  if (
    typeof performance === 'undefined' ||
    typeof performance.measure !== 'function'
  ) {
    return false;
  }
  if (!hasMark(start) || (end && !hasMark(end))) {
    return false;
  }
  if (typeof performance.clearMeasures === 'function') {
    performance.clearMeasures(metricName);
  }
  performance.measure(metricName, start, end);
  return true;
};

const normalizeChannelFromVersion = (version: string | undefined): string | undefined => {
  if (!version) return undefined;
  const lower = version.toLowerCase();
  if (lower.includes('alpha')) return 'alpha';
  if (lower.includes('beta')) return 'beta';
  if (lower.includes('rc')) return 'rc';
  return undefined;
};

const normalizeChannelFromMode = (mode: string | undefined): string | undefined => {
  if (!mode) return undefined;
  if (mode === 'production') return 'stable';
  if (mode === 'development') return 'dev';
  return mode;
};

export const deriveBuildMetadata = (): Pick<
  ClientMetricComplexityPayload,
  'build_version' | 'build_channel'
> => {
  const runtimeWindow = (typeof window !== 'undefined' ? window : undefined) as RuntimeWindow | undefined;
  const buildVersion =
    normalizeString(import.meta.env?.VITE_APP_VERSION) ??
    normalizeString(runtimeWindow?.__LECTERN_BUILD__?.version) ??
    normalizeString(runtimeWindow?.__LECTERN_VERSION__);

  const buildChannel =
    normalizeString(import.meta.env?.VITE_BUILD_CHANNEL) ??
    normalizeString(runtimeWindow?.__LECTERN_BUILD__?.channel) ??
    normalizeString(runtimeWindow?.__LECTERN_CHANNEL__) ??
    normalizeChannelFromVersion(buildVersion) ??
    normalizeChannelFromMode(normalizeString(import.meta.env?.MODE));

  return {
    build_version: buildVersion,
    build_channel: buildChannel,
  };
};

const normalizeComplexity = (
  complexity: ClientMetricComplexityPayload
): ClientMetricComplexityPayload => {
  const runtimeBuild = deriveBuildMetadata();
  const totalPages = normalizeMetric(complexity.total_pages);
  const textChars = normalizeMetric(complexity.text_chars);
  const charsPerPage =
    normalizeMetric(complexity.chars_per_page) ??
    (isFiniteNonNegative(textChars) && isFiniteNonNegative(totalPages) && totalPages > 0
      ? textChars / totalPages
      : undefined);

  return {
    card_count: normalizeMetric(complexity.card_count),
    target_card_count: normalizeMetric(complexity.target_card_count),
    total_pages: totalPages,
    text_chars: textChars,
    chars_per_page: charsPerPage,
    model: normalizeString(complexity.model),
    build_version: normalizeString(complexity.build_version) ?? runtimeBuild.build_version,
    build_channel: normalizeString(complexity.build_channel) ?? runtimeBuild.build_channel,
    document_type: normalizeString(complexity.document_type),
    image_count: normalizeMetric(complexity.image_count),
  };
};

export const buildClientMetricsPayload = ({
  sessionId,
  complexity,
  clientTsMs = Date.now(),
  metricNames,
}: BuildClientMetricsPayloadOptions): ClientMetricsPayload | null => {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) return null;
  if (
    typeof performance === 'undefined' ||
    typeof performance.getEntriesByType !== 'function'
  ) {
    return null;
  }

  const measures = performance.getEntriesByType('measure');
  const allowedMetricNames = metricNames
    ? new Set(
        metricNames
          .map((name) => normalizeString(name))
          .filter((name): name is string => Boolean(name))
      )
    : null;
  const normalizedComplexity = normalizeComplexity(complexity);
  const entries = measures
    .map((entry) => {
      const metricName = normalizeString(entry.name);
      if (
        !metricName ||
        !hasOwnedMeasurePrefix(metricName) ||
        (allowedMetricNames !== null && !allowedMetricNames.has(metricName)) ||
        !isFiniteNonNegative(entry.duration)
      ) {
        return null;
      }
      return {
        metric_name: metricName,
        duration_ms: entry.duration,
        complexity: normalizedComplexity,
      };
    })
    .filter((entry): entry is ClientMetricEntryPayload => entry !== null);

  if (entries.length === 0) return null;

  return {
    client_ts_ms: clientTsMs,
    session_id: normalizedSessionId,
    entries,
  };
};

export const getPayloadMeasureNames = (payload: ClientMetricsPayload): string[] =>
  Array.from(
    new Set(
      payload.entries
        .map((entry) => normalizeString(entry.metric_name))
        .filter((name): name is string => Boolean(name))
    )
  );
