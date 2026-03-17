/**
 * Hook that owns onboarding orchestration: health checks, sequence logic, polling.
 * Keeps OnboardingFlow as a pure presentational component.
 */
import { useState, useEffect, useCallback } from 'react';
import { useHealthQuery } from '../queries';
import { useOnboardingManager } from './useOnboardingManager';

export type StepStatus = 'pending' | 'active' | 'success' | 'error';

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

  const startSequence = useCallback(async () => {
    setAnkiStatus('active');
    await new Promise((r) => setTimeout(r, 1000));

    if (healthError) {
      setAnkiStatus('error');
      return;
    }
    if (health) {
      if (health.anki_connected) {
        setAnkiStatus('success');
        if (health.gemini_configured) {
          setGeminiStatus('success');
          completeOnboarding();
        } else {
          setGeminiStatus('active');
        }
      } else {
        setAnkiStatus('error');
      }
    }
  }, [health, healthError, completeOnboarding]);

  // Orchestration: run sequence on mount. Defer to next tick to avoid sync setState-in-effect.
  useEffect(() => {
    const id = setTimeout(() => startSequence(), 0);
    return () => clearTimeout(id);
  }, [startSequence]);

  useEffect(() => {
    if (ankiStatus !== 'error') return;

    const poll = setInterval(async () => {
      const result = await refetchHealth();
      const data = result?.data;
      if (data?.anki_connected) {
        clearInterval(poll);
        setAnkiStatus('success');
        if (data.gemini_configured) {
          setGeminiStatus('success');
          completeOnboarding();
        } else {
          setGeminiStatus('active');
        }
      }
    }, 3000);

    return () => clearInterval(poll);
  }, [ankiStatus, refetchHealth, completeOnboarding]);

  const retryAnki = useCallback(() => {
    setAnkiStatus('pending');
    refetchHealth();
    setTimeout(() => startSequence(), 300);
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
  };
}
