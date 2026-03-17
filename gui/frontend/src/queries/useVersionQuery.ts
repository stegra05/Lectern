import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { queryKeys } from '../lib/queryKeys';

export interface VersionInfo {
  current: string;
  latest: string | null;
  update_available: boolean;
  release_url: string;
}

/**
 * Hook for checking application version.
 * Used by SettingsModal to check for updates.
 */
export function useVersionQuery(enabled: boolean = true) {
  return useQuery<VersionInfo>({
    queryKey: queryKeys.version,
    queryFn: api.getVersion,
    enabled,
    staleTime: 1000 * 60 * 60, // 1 hour - version doesn't change frequently
    gcTime: 1000 * 60 * 60 * 24, // 24 hours
    retry: 1,
  });
}
