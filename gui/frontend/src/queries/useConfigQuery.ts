import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { queryKeys } from '../lib/queryKeys';
import type { Config } from '../schemas/api';

export interface SaveConfigPayload {
  gemini_api_key?: string;
  anki_url?: string;
  basic_model?: string;
  cloze_model?: string;
  gemini_model?: string;
  tag_template?: string;
}

/**
 * Hook for fetching configuration.
 */
export function useConfigQuery() {
  return useQuery<Config>({
    queryKey: queryKeys.config,
    queryFn: api.getConfig,
    staleTime: 1000 * 60 * 5, // 5 minutes - config doesn't change often
  });
}

/**
 * Hook for saving configuration.
 * Invalidates config and health queries on success.
 */
export function useSaveConfigMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: SaveConfigPayload) => api.saveConfig(payload),
    onSuccess: () => {
      // Invalidate both config and health since API key affects health status
      queryClient.invalidateQueries({ queryKey: queryKeys.config });
      queryClient.invalidateQueries({ queryKey: queryKeys.health });
    },
  });
}
