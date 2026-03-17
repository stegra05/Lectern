import { useHealthQuery, useSaveConfigMutation } from '../queries';

/**
 * Facade hook for the onboarding flow.
 * Coordinates health checks and config saves during onboarding.
 */
export function useOnboardingManager() {
  const { data: health, isLoading, isError, refetch } = useHealthQuery();
  const saveConfigMutation = useSaveConfigMutation();

  // Determine if onboarding is needed
  const isOnboardingNeeded =
    !health?.anki_connected || !health?.gemini_configured;

  // Save API key during onboarding
  const saveApiKey = async (apiKey: string) => {
    await saveConfigMutation.mutateAsync({ gemini_api_key: apiKey });
  };

  return {
    // Health status
    health,
    isLoading,
    isError,
    isOnboardingNeeded,

    // Actions
    saveApiKey,
    saveApiKeyStatus: saveConfigMutation.status,
    refetchHealth: () => refetch(),
  };
}
