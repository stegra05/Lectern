import type { components } from '../generated/api';
import type { HealthStatus } from '../schemas/api';

type HealthDiagnostics = components['schemas']['HealthDiagnostics'];

type OptionalHealthDiagnostics = {
  anki?: Partial<HealthDiagnostics['anki']> | null;
  api_key?: Partial<HealthDiagnostics['api_key']> | null;
  provider?: Partial<HealthDiagnostics['provider']> | null;
};

export type HealthStatusLike = Partial<Omit<HealthStatus, 'diagnostics'>> & {
  diagnostics?: OptionalHealthDiagnostics | null;
};

export type HealthRemediationKind =
  | 'none'
  | 'anki_offline'
  | 'anki_unreachable'
  | 'missing_api_key'
  | 'unsupported_provider'
  | 'provider_not_ready';

export interface HealthRemediation {
  kind: HealthRemediationKind;
  title?: string;
  message?: string;
  hint?: string;
  canRetry: boolean;
}

export interface AnkiPreflight {
  status: 'connected' | 'checking' | 'disconnected';
  hint?: string;
}

const DEFAULT_ANKI_HINT =
  'Start Anki and ensure AnkiConnect is installed/enabled (add-on code: 2055492159).';
const DEFAULT_API_KEY_HINT = 'Open Settings and provide the required API key.';
const DEFAULT_PROVIDER_HINT = 'Review provider settings and try again.';

function getDiagnostics(
  health: HealthStatusLike | null | undefined
): OptionalHealthDiagnostics | undefined {
  return health?.diagnostics ?? undefined;
}

function textOrUndefined(value: string | null | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

function getProviderName(
  health: HealthStatusLike | null | undefined,
  diagnostics: OptionalHealthDiagnostics | undefined
): string | undefined {
  return textOrUndefined(diagnostics?.provider?.name) ?? textOrUndefined(health?.active_provider);
}

function providerLabel(name: string | undefined): string {
  if (!name) return 'Provider';
  return name.slice(0, 1).toUpperCase() + name.slice(1);
}

function isUnsupportedProvider(providerReason: string | undefined): boolean {
  return providerReason?.toLowerCase().includes('unsupported') ?? false;
}

function isGeminiProvider(providerName: string | undefined): boolean {
  return providerName?.toLowerCase() === 'gemini';
}

export function getHealthRemediation(
  health: HealthStatusLike | null | undefined
): HealthRemediation {
  if (!health) {
    return { kind: 'none', canRetry: false };
  }

  const runtimeHealth = health;
  const diagnostics = getDiagnostics(health);
  const ankiDiagnostics = diagnostics?.anki;
  const ankiConnected = ankiDiagnostics?.connected ?? runtimeHealth.anki_connected ?? false;

  if (!ankiConnected) {
    const ankiStatus = ankiDiagnostics?.status;
    const message =
      textOrUndefined(ankiDiagnostics?.reason) ?? 'Anki connection check returned offline.';
    const hint = textOrUndefined(ankiDiagnostics?.hint) ?? DEFAULT_ANKI_HINT;

    if (ankiStatus === 'unreachable') {
      return {
        kind: 'anki_unreachable',
        title: 'Cannot reach AnkiConnect',
        message,
        hint,
        canRetry: true,
      };
    }

    return {
      kind: 'anki_offline',
      title: 'Anki is offline',
      message,
      hint,
      canRetry: true,
    };
  }

  const providerDiagnostics = diagnostics?.provider;
  const apiKeyDiagnostics = diagnostics?.api_key;
  const providerName = getProviderName(runtimeHealth, diagnostics);
  const providerReason = textOrUndefined(providerDiagnostics?.reason);
  const providerHint = textOrUndefined(providerDiagnostics?.hint);

  if (isUnsupportedProvider(providerReason)) {
    return {
      kind: 'unsupported_provider',
      title: 'Unsupported AI provider',
      message:
        providerReason ??
        `Provider '${providerName ?? 'unknown'}' is not supported.`,
      hint: providerHint ?? DEFAULT_PROVIDER_HINT,
      canRetry: false,
    };
  }

  const apiKeyRequired =
    apiKeyDiagnostics?.required ??
    (providerName ? isGeminiProvider(providerName) : true);
  const apiKeyConfigured = apiKeyDiagnostics?.configured ?? runtimeHealth.gemini_configured ?? false;

  if (apiKeyRequired && !apiKeyConfigured) {
    const title = `${providerLabel(providerName)} API key required`;
    const message =
      textOrUndefined(apiKeyDiagnostics?.reason) ??
      `${providerLabel(providerName)} API key is missing.`;
    const hint =
      textOrUndefined(apiKeyDiagnostics?.hint) ?? providerHint ?? DEFAULT_API_KEY_HINT;

    return {
      kind: 'missing_api_key',
      title,
      message,
      hint,
      canRetry: false,
    };
  }

  const providerReady =
    providerDiagnostics?.ready ?? runtimeHealth.provider_ready ?? apiKeyConfigured;
  const providerConfigured =
    providerDiagnostics?.configured ?? runtimeHealth.provider_configured ?? providerReady;

  if (!providerReady || !providerConfigured || runtimeHealth.backend_ready === false) {
    return {
      kind: 'provider_not_ready',
      title: `${providerLabel(providerName)} provider not ready`,
      message:
        providerReason ??
        `${providerLabel(providerName)} is not ready yet. Check provider configuration.`,
      hint: providerHint ?? DEFAULT_PROVIDER_HINT,
      canRetry: true,
    };
  }

  return { kind: 'none', canRetry: false };
}

export function isHealthReady(health: HealthStatusLike | null | undefined): boolean {
  if (!health) {
    return false;
  }

  const runtimeHealth = health;
  if (runtimeHealth.backend_ready === false) {
    return false;
  }

  const diagnostics = getDiagnostics(health);
  const ankiConnected = diagnostics?.anki?.connected ?? runtimeHealth.anki_connected ?? false;
  if (!ankiConnected) {
    return false;
  }

  const providerName = getProviderName(runtimeHealth, diagnostics);
  const providerReady =
    diagnostics?.provider?.ready ?? runtimeHealth.provider_ready ?? runtimeHealth.gemini_configured ?? false;
  const providerConfigured =
    diagnostics?.provider?.configured ?? runtimeHealth.provider_configured ?? providerReady;
  const apiKeyRequired =
    diagnostics?.api_key?.required ?? (providerName ? isGeminiProvider(providerName) : true);
  const apiKeyConfigured =
    diagnostics?.api_key?.configured ?? runtimeHealth.gemini_configured ?? false;

  return Boolean(providerReady && providerConfigured && (!apiKeyRequired || apiKeyConfigured));
}

export function getAnkiPreflight(
  health: HealthStatusLike | null | undefined
): AnkiPreflight {
  if (!health) {
    return { status: 'checking' };
  }

  const runtimeHealth = health;
  const diagnostics = getDiagnostics(health);
  const ankiConnected = diagnostics?.anki?.connected ?? runtimeHealth.anki_connected ?? false;

  if (ankiConnected) {
    return { status: 'connected' };
  }

  return {
    status: 'disconnected',
    hint:
      textOrUndefined(diagnostics?.anki?.hint) ??
      textOrUndefined(diagnostics?.anki?.reason) ??
      DEFAULT_ANKI_HINT,
  };
}
