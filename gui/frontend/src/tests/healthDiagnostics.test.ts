import { describe, expect, it } from 'vitest';

import type { HealthStatus } from '../schemas/api';
import {
  getAnkiPreflight,
  getHealthRemediation,
  isHealthReady,
  type HealthStatusLike,
} from '../lib/healthDiagnostics';

const healthyDiagnosticsHealth: HealthStatus = {
  status: 'ok',
  anki_connected: true,
  gemini_configured: true,
  active_provider: 'gemini',
  provider_configured: true,
  provider_ready: true,
  backend_ready: true,
  diagnostics: {
    anki: {
      status: 'healthy',
      connected: true,
    },
    api_key: {
      required: true,
      configured: true,
    },
    provider: {
      name: 'gemini',
      configured: true,
      ready: true,
    },
  },
};

describe('healthDiagnostics', () => {
  it('prioritizes Anki diagnostics when multiple systems are unhealthy', () => {
    const remediation = getHealthRemediation({
      ...healthyDiagnosticsHealth,
      anki_connected: false,
      gemini_configured: false,
      provider_configured: false,
      provider_ready: false,
      diagnostics: {
        anki: {
          status: 'unreachable',
          connected: false,
          reason: 'Connection refused by AnkiConnect at localhost:8765.',
          hint: 'Start Anki and ensure AnkiConnect is installed/enabled.',
        },
        api_key: {
          required: true,
          configured: false,
          reason: 'Gemini API key is missing.',
          hint: 'Open Settings and provide a Gemini API key.',
        },
        provider: {
          name: 'gemini',
          configured: false,
          ready: false,
          reason: 'Gemini provider requires an API key.',
          hint: 'Add a Gemini API key in Settings to enable generation.',
        },
      },
    });

    expect(remediation.kind).toBe('anki_unreachable');
    expect(remediation.message).toBe('Connection refused by AnkiConnect at localhost:8765.');
    expect(remediation.hint).toBe('Start Anki and ensure AnkiConnect is installed/enabled.');
    expect(remediation.canRetry).toBe(true);
  });

  it('returns API key remediation from diagnostics when key is missing', () => {
    const remediation = getHealthRemediation({
      ...healthyDiagnosticsHealth,
      gemini_configured: false,
      provider_configured: false,
      provider_ready: false,
      diagnostics: {
        ...healthyDiagnosticsHealth.diagnostics,
        api_key: {
          required: true,
          configured: false,
          reason: 'Gemini API key is missing.',
          hint: 'Open Settings and provide a Gemini API key.',
        },
        provider: {
          ...healthyDiagnosticsHealth.diagnostics.provider,
          configured: false,
          ready: false,
        },
      },
    });

    expect(remediation.kind).toBe('missing_api_key');
    expect(remediation.message).toBe('Gemini API key is missing.');
    expect(remediation.hint).toBe('Open Settings and provide a Gemini API key.');
    expect(remediation.canRetry).toBe(false);
  });

  it('falls back to legacy fields when diagnostics are absent', () => {
    const legacyHealth: HealthStatusLike = {
      ...healthyDiagnosticsHealth,
      diagnostics: undefined,
      anki_connected: false,
    };

    const remediation = getHealthRemediation(legacyHealth);

    expect(remediation.kind).toBe('anki_offline');
    expect(remediation.canRetry).toBe(true);
  });

  it('falls back to legacy Gemini readiness when diagnostics are absent', () => {
    const legacyHealth: HealthStatusLike = {
      ...healthyDiagnosticsHealth,
      diagnostics: undefined,
      gemini_configured: false,
    };

    const remediation = getHealthRemediation(legacyHealth);

    expect(remediation.kind).toBe('missing_api_key');
    expect(remediation.canRetry).toBe(false);
  });

  it('identifies unsupported provider from diagnostics reason', () => {
    const remediation = getHealthRemediation({
      ...healthyDiagnosticsHealth,
      active_provider: 'unknown-provider',
      provider_configured: false,
      provider_ready: false,
      diagnostics: {
        ...healthyDiagnosticsHealth.diagnostics,
        provider: {
          name: 'unknown-provider',
          configured: false,
          ready: false,
          reason: "Unsupported provider 'unknown-provider'.",
          hint: 'Set ai_provider to a supported backend (e.g. gemini).',
        },
      },
    });

    expect(remediation.kind).toBe('unsupported_provider');
    expect(remediation.canRetry).toBe(false);
  });

  it('returns checking preflight while health is loading', () => {
    expect(getAnkiPreflight(undefined)).toEqual({ status: 'checking' });
  });

  it('returns disconnected preflight with diagnostics hint', () => {
    const preflight = getAnkiPreflight({
      ...healthyDiagnosticsHealth,
      anki_connected: false,
      diagnostics: {
        ...healthyDiagnosticsHealth.diagnostics,
        anki: {
          status: 'offline',
          connected: false,
          reason: 'Anki connection check returned offline.',
          hint: 'Start Anki and ensure AnkiConnect is installed/enabled.',
        },
      },
    });

    expect(preflight.status).toBe('disconnected');
    expect(preflight.hint).toBe('Start Anki and ensure AnkiConnect is installed/enabled.');
  });

  it('reports readiness from diagnostics when all systems are healthy', () => {
    expect(isHealthReady(healthyDiagnosticsHealth)).toBe(true);
  });

  it('reports not-ready when diagnostics show provider is not ready', () => {
    expect(
      isHealthReady({
        ...healthyDiagnosticsHealth,
        provider_ready: false,
        diagnostics: {
          ...healthyDiagnosticsHealth.diagnostics,
          provider: {
            ...healthyDiagnosticsHealth.diagnostics.provider,
            ready: false,
          },
        },
      })
    ).toBe(false);
  });
});
