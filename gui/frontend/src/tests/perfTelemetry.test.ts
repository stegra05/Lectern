import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildClientMetricsPayload, deriveBuildMetadata } from '../lib/perfTelemetry';

describe('perf telemetry exporter', () => {
  let getEntriesByTypeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getEntriesByTypeSpy = vi.spyOn(performance, 'getEntriesByType');
  });

  afterEach(() => {
    getEntriesByTypeSpy.mockRestore();
  });

  it('maps performance measures to /metrics/client payload entries with complexity context', () => {
    getEntriesByTypeSpy.mockReturnValue([
      {
        name: 'estimate_pdf_ms',
        duration: 123.45,
        entryType: 'measure',
        startTime: 0,
        toJSON: () => ({}),
      } as PerformanceEntry,
      {
        name: 'generate_cards_ms',
        duration: 456.78,
        entryType: 'measure',
        startTime: 0,
        toJSON: () => ({}),
      } as PerformanceEntry,
    ]);

    const payload = buildClientMetricsPayload({
      sessionId: 'session-123',
      complexity: {
        card_count: 10,
        target_card_count: 12,
        total_pages: 20,
        text_chars: 4200,
        model: 'gemini-2.5-flash',
        build_version: '1.2.3',
        build_channel: 'stable',
        document_type: 'slides',
        image_count: 3,
      },
      clientTsMs: 1710000000000,
    });

    expect(payload).toEqual({
      client_ts_ms: 1710000000000,
      session_id: 'session-123',
      entries: [
        {
          metric_name: 'estimate_pdf_ms',
          duration_ms: 123.45,
          complexity: {
            card_count: 10,
            target_card_count: 12,
            total_pages: 20,
            text_chars: 4200,
            chars_per_page: 210,
            model: 'gemini-2.5-flash',
            build_version: '1.2.3',
            build_channel: 'stable',
            document_type: 'slides',
            image_count: 3,
          },
        },
        {
          metric_name: 'generate_cards_ms',
          duration_ms: 456.78,
          complexity: {
            card_count: 10,
            target_card_count: 12,
            total_pages: 20,
            text_chars: 4200,
            chars_per_page: 210,
            model: 'gemini-2.5-flash',
            build_version: '1.2.3',
            build_channel: 'stable',
            document_type: 'slides',
            image_count: 3,
          },
        },
      ],
    });
  });

  it('returns null when no measure entries are available', () => {
    getEntriesByTypeSpy.mockReturnValue([]);

    const payload = buildClientMetricsPayload({
      sessionId: 'session-123',
      complexity: {},
      clientTsMs: 1710000000000,
    });

    expect(payload).toBeNull();
  });

  it('derives build metadata from runtime globals when env values are absent', () => {
    (window as Window & { __LECTERN_BUILD__?: { version?: string; channel?: string } }).__LECTERN_BUILD__ = {
      version: '9.9.9',
      channel: 'stable',
    };

    const metadata = deriveBuildMetadata();

    expect(metadata).toEqual({
      build_version: '9.9.9',
      build_channel: 'stable',
    });
  });
});
