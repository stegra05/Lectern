/**
 * Hook that owns onboarding orchestration: health checks, sequence logic, polling.
 * Keeps OnboardingFlow as a pure presentational component.
 */
import { useState, useEffect, useCallback } from 'react';
import type { components } from '../generated/api';
import { useHealthQuery } from '../queries';
import type { HealthStatus } from '../schemas/api';
import { getHealthRemediation, isHealthReady } from '../lib/healthDiagnostics';
import { useOnboardingManager } from './useOnboardingManager';

export type StepStatus = 'pending' | 'active' | 'success' | 'error';

type HealthDiagnostics = components['schemas']['HealthDiagnostics'];

type OptionalHealthDiagnostics = {
  anki?: Partial<HealthDiagnostics['anki']> | null;
  api_key?: Partial<HealthDiagnostics['api_key']> | null;
};

type HealthWithOptionalDiagnostics = Omit<HealthStatus, 'diagnostics'> & {
  diagnostics?: OptionalHealthDiagnostics | null;
};

export interface OnboardingDiagnosticsDetails {
  reason?: string;
  hint?: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function textOrUndefined(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isAnkiFailureKind(kind: ReturnType<typeof getHealthRemediation>['kind']): boolean {
  return kind === 'anki_offline' || kind === 'anki_unreachable';
}

function getDiagnostics(
  health: HealthStatus | null | undefined
): OptionalHealthDiagnostics | undefined {
  return (health as HealthWithOptionalDiagnostics | null | undefined)?.diagnostics ?? undefined;
}

export function useOnboardingFlow(onComplete: () => void) {
  const [ankiStatus, setAnkiStatus] = useState<StepStatus>('pending');
  const [geminiStatus, setGeminiStatus] = useState<StepStatus>('pending');
  const [apiKey, setApiKey] = useState('');
  const [isExiting, setIsExiting] = useState(false);

  const { data: health, isError: healthError, refetch: refetchHealth } = useHealthQuery();
  const { saveApiKey: saveApiKeyMutation, saveApiKeyStatus } = useOnboardingManager();

  const completeOnboarding = useCallback(() => {
    setTimeout(() => {
      setIsExiting(true);
      setTimeout(onComplete, 800);
    }, 1000);
  }, [onComplete]);

  const applyHealthState = useCallback((nextHealth: HealthStatus | null | undefined) => {
    if (!nextHealth) {
      setAnkiStatus('error');
      return;
    }

    const remediation = getHealthRemediation(nextHealth);
    if (isAnkiFailureKind(remediation.kind)) {
      setAnkiStatus('error');
      return;
    }

    setAnkiStatus('success');
    if (isHealthReady(nextHealth)) {
      setGeminiStatus('success');
      completeOnboarding();
    } else {
      setGeminiStatus('active');
    }
  }, [completeOnboarding]);

  const startSequence = useCallback(async (healthSnapshot?: HealthStatus | null) => {
    setAnkiStatus('active');
    await delay(1000);

    if (!healthSnapshot && healthError) {
      setAnkiStatus('error');
      return;
    }

    applyHealthState(healthSnapshot ?? health);
  }, [applyHealthState, health, healthError]);

  // Orchestration: run sequence on mount. Defer to next tick to avoid sync setState-in-effect.
  useEffect(() => {
    const id = setTimeout(() => {
      void startSequence();
    }, 0);
    return () => clearTimeout(id);
  }, [startSequence]);

  useEffect(() => {
    if (ankiStatus !== 'error') return;

    const poll = setInterval(async () => {
      const result = await refetchHealth();
      const data = result?.data;
      if (!data) return;

      const remediation = getHealthRemediation(data);
      if (!isAnkiFailureKind(remediation.kind)) {
        clearInterval(poll);
        applyHealthState(data);
      }
    }, 3000);

    return () => clearInterval(poll);
  }, [ankiStatus, refetchHealth, applyHealthState]);

  const retryAnki = useCallback(async () => {
    setAnkiStatus('pending');
    const result = await refetchHealth();
    const freshHealth = result?.data;
    setTimeout(() => {
      void startSequence(freshHealth);
    }, 300);
  }, [refetchHealth, startSequence]);

  const skipAnki = useCallback(() => {
    setAnkiStatus('success');
    if (health?.gemini_configured) {
      setGeminiStatus('success');
      completeOnboarding();
    } else {
      setGeminiStatus('active');
    }
  }, [health, completeOnboarding]);

  const submitApiKey = useCallback(async () => {
    if (!apiKey.trim()) return;
    try {
      await saveApiKeyMutation(apiKey);
      setGeminiStatus('success');
      completeOnboarding();
    } catch (e) {
      console.error('Failed to save config', e);
    }
  }, [apiKey, saveApiKeyMutation, completeOnboarding]);

  const remediation = getHealthRemediation(health);
  const diagnostics = getDiagnostics(health);

  const ankiDiagnosticsReason = textOrUndefined(diagnostics?.anki?.reason);
  const ankiDiagnosticsHint = textOrUndefined(diagnostics?.anki?.hint);
  const ankiDiagnostics =
    ankiStatus === 'error' && isAnkiFailureKind(remediation.kind) && (ankiDiagnosticsReason || ankiDiagnosticsHint)
      ? {
          reason: ankiDiagnosticsReason ?? remediation.message,
          hint: ankiDiagnosticsHint ?? remediation.hint,
        }
      : undefined;

  const apiKeyDiagnosticsReason = textOrUndefined(diagnostics?.api_key?.reason);
  const apiKeyDiagnosticsHint = textOrUndefined(diagnostics?.api_key?.hint);
  const apiKeyDiagnostics =
    geminiStatus === 'active' &&
    remediation.kind === 'missing_api_key' &&
    (apiKeyDiagnosticsReason || apiKeyDiagnosticsHint)
      ? {
          reason: apiKeyDiagnosticsReason ?? remediation.message,
          hint: apiKeyDiagnosticsHint ?? remediation.hint,
        }
      : undefined;

  return {
    ankiStatus,
    geminiStatus,
    apiKey,
    setApiKey,
    isExiting,
    health,
    saveApiKeyStatus,
    retryAnki,
    skipAnki,
    submitApiKey,
    completeOnboarding,
    ankiDiagnostics,
    apiKeyDiagnostics,
  };
}
