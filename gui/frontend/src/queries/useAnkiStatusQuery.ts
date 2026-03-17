import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { queryKeys } from '../lib/queryKeys';
import type { AnkiStatus } from '../schemas/api';

/**
 * Hook for checking AnkiConnect status.
 * Used by AnkiHealthPanel for detailed diagnostics.
 */
export function useAnkiStatusQuery(enabled: boolean = true) {
  return useQuery<AnkiStatus>({
    queryKey: queryKeys.ankiStatus,
    queryFn: api.getAnkiStatus,
    enabled,
    staleTime: 1000 * 10, // 10 seconds
    gcTime: 1000 * 30, // 30 seconds
    retry: 0, // Don't retry - we want to show errors immediately
  });
}
