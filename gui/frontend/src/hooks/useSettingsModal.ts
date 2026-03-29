/**
 * Hook that owns all data fetching and orchestration for the Settings modal.
 * Keeps SettingsModal as a pure presentational component.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useConfigQuery, useSaveConfigMutation, useVersionQuery, useClearLogsMutation } from '../queries';
import { api } from '../api';
import type { Config, HealthStatus } from '../schemas/api';
import { getAnkiPreflight } from '../lib/healthDiagnostics';

export interface ConfigState {
  gemini_model: string;
  anki_url: string;
  basic_model: string;
  cloze_model: string;
  tag_template: string;
}

export type AnkiCheckStatus = 'checking' | 'connected' | 'disconnected';

const INVALID_ANKI_URL_ERROR =
  'Use a full URL including protocol (http:// or https://), e.g. http://localhost:8765.';
const OFFLINE_ANKI_HINT =
  'Open Anki and verify AnkiConnect is installed/enabled (add-on code: 2055492159).';

function configToState(c: Config): ConfigState {
  return {
    gemini_model: c.gemini_model ?? 'gemini-3-flash-preview',
    anki_url: c.anki_url ?? 'http://localhost:8765',
    basic_model: c.basic_model ?? 'Basic',
    cloze_model: c.cloze_model ?? 'Cloze',
    tag_template: c.tag_template ?? '{{deck}}::{{slide_set}}::{{topic}}',
  };
}

function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function buildAnkiPreflightHealth(connected: boolean, hint?: string): HealthStatus {
  return {
    status: connected ? 'healthy' : 'degraded',
    active_provider: 'gemini',
    anki_connected: connected,
    backend_ready: true,
    gemini_configured: true,
    provider_configured: true,
    provider_ready: true,
    diagnostics: {
      anki: {
        status: connected ? 'healthy' : 'offline',
        connected,
        reason: connected ? undefined : 'Anki connection check returned offline.',
        hint,
      },
      api_key: {
        required: false,
        configured: true,
      },
      provider: {
        name: 'gemini',
        configured: true,
        ready: true,
      },
    },
  };
}

export function useSettingsModal(isOpen: boolean) {
  const [editedConfig, setEditedConfig] = useState<ConfigState | null>(null);
  const [newKey, setNewKey] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [logsClearSuccess, setLogsClearSuccess] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showBudget, setShowBudget] = useState(false);

  const { data: config, isLoading, isError, refetch: refetchConfig } = useConfigQuery();
  const { data: versionInfo, isLoading: versionLoading, refetch: refetchVersion } = useVersionQuery(isOpen);
  const saveConfigMutation = useSaveConfigMutation();
  const clearLogsMutation = useClearLogsMutation();

  // Sync server config to local edit state when config loads/changes
  useEffect(() => {
    if (config) {
      /* eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: sync server state to local form */
      setEditedConfig(configToState(config));
      setNewKey('');
      setSaveSuccess(false);
    }
  }, [config]);

  const ankiUrl = editedConfig?.anki_url ?? '';
  const shouldCheckAnki = Boolean(isOpen && ankiUrl && isValidUrl(ankiUrl));
  const ankiStatusQuery = useQuery({
    queryKey: ['anki-connect-check', ankiUrl],
    enabled: shouldCheckAnki,
    retry: 1,
    queryFn: () => api.checkAnkiConnectUrl(ankiUrl),
  });

  const ankiPreflight = useMemo(() => {
    if (!ankiUrl) return { status: 'checking' } as const;
    if (!isValidUrl(ankiUrl)) {
      return { status: 'disconnected', hint: INVALID_ANKI_URL_ERROR } as const;
    }
    if (ankiStatusQuery.isLoading || ankiStatusQuery.isFetching) return { status: 'checking' } as const;
    return getAnkiPreflight(
      buildAnkiPreflightHealth(
        Boolean(ankiStatusQuery.data?.connected),
        ankiStatusQuery.data?.connected ? undefined : OFFLINE_ANKI_HINT
      )
    );
  }, [
    ankiUrl,
    ankiStatusQuery.data?.connected,
    ankiStatusQuery.isFetching,
    ankiStatusQuery.isLoading,
  ]);

  const ankiStatus: AnkiCheckStatus = ankiPreflight.status;
  const canRetryAnkiConnection = ankiStatus === 'disconnected' && isValidUrl(ankiUrl);

  const updateField = useCallback((field: keyof ConfigState, value: string) => {
    if (!editedConfig) return;
    setEditedConfig({ ...editedConfig, [field]: value });
  }, [editedConfig]);

  const hasChanges = Boolean(
    config &&
      editedConfig &&
      (config.gemini_model !== editedConfig.gemini_model ||
        config.anki_url !== editedConfig.anki_url ||
        config.basic_model !== editedConfig.basic_model ||
        config.cloze_model !== editedConfig.cloze_model ||
        config.tag_template !== editedConfig.tag_template ||
        newKey.length > 0)
  );

  const ankiUrlError =
    editedConfig && editedConfig.anki_url && !isValidUrl(editedConfig.anki_url)
      ? INVALID_ANKI_URL_ERROR
      : null;

  const retryAnkiConnection = useCallback(async () => {
    if (!isValidUrl(ankiUrl)) {
      return;
    }
    await ankiStatusQuery.refetch();
  }, [ankiStatusQuery, ankiUrl]);

  const handleSave = useCallback(async () => {
    if (!editedConfig || !hasChanges || ankiUrlError) return;
    const payload: Record<string, string> = {
      gemini_model: editedConfig.gemini_model,
      anki_url: editedConfig.anki_url,
      basic_model: editedConfig.basic_model,
      cloze_model: editedConfig.cloze_model,
      tag_template: editedConfig.tag_template,
    };
    if (newKey.trim()) payload.gemini_api_key = newKey.trim();
    try {
      await saveConfigMutation.mutateAsync(payload);
      setNewKey('');
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      console.error(err);
    }
  }, [editedConfig, hasChanges, ankiUrlError, newKey, saveConfigMutation]);

  const clearLogs = useCallback(async () => {
    try {
      await clearLogsMutation.mutateAsync();
      setLogsClearSuccess(true);
      setTimeout(() => setLogsClearSuccess(false), 2500);
    } catch (err) {
      console.error(err);
    }
  }, [clearLogsMutation]);

  return {
    config: editedConfig,
    isLoading,
    error: isError ? 'Failed to connect to backend' : null,
    refetchConfig,
    versionInfo,
    versionLoading: versionLoading,
    refetchVersion,
    saveConfig: handleSave,
    isSaving: saveConfigMutation.isPending,
    editedConfig,
    updateField,
    newKey,
    setNewKey,
    ankiStatus,
    ankiHint: ankiPreflight.hint,
    canRetryAnkiConnection,
    retryAnkiConnection,
    isRetryingAnkiConnection: ankiStatusQuery.isFetching,
    ankiUrlError,
    hasChanges,
    saveSuccess,
    logsClearSuccess,
    clearLogs,
    isClearingLogs: clearLogsMutation.isPending,
    showAdvanced,
    setShowAdvanced,
    showBudget,
    setShowBudget,
  };
}
