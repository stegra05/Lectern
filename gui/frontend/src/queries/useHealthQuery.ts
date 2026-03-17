import { useQuery } from '@tanstack/react-query';
import { api, type HealthStatus } from '../api';
import { queryKeys } from '../lib/queryKeys';

/**
 * Hook for health status polling with smart intervals.
 * Polls more frequently (3s) when offline, less frequently (30s) when online.
 */
export function useHealthQuery() {
  return useQuery<HealthStatus>({
    queryKey: queryKeys.health,
    queryFn: api.checkHealth,
    refetchInterval: (query) => {
      const data = query.state.data;
      // Poll every 3s when something is offline, 30s when everything is online
      if (!data || !data.anki_connected || !data.gemini_configured) {
        return 3000;
      }
      return 30000;
    },
    refetchOnWindowFocus: true,
    staleTime: 2000, // Consider data stale after 2s
    gcTime: 1000 * 60, // Keep in cache for 1 minute
  });
}

export type { HealthStatus };
