import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type HistoryEntry } from '../api';
import { queryKeys } from '../lib/queryKeys';

/**
 * Hook for fetching generation history.
 */
export function useHistoryQuery() {
  return useQuery<HistoryEntry[]>({
    queryKey: queryKeys.history,
    queryFn: api.getHistory,
    staleTime: 1000 * 30, // 30 seconds
  });
}

/**
 * Hook for deleting a single history entry.
 */
export function useDeleteHistoryMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.deleteHistoryEntry(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.history });
    },
  });
}

/**
 * Hook for clearing all history.
 */
export function useClearHistoryMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.clearHistory(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.history });
    },
  });
}

/**
 * Hook for batch deleting history entries.
 */
export function useBatchDeleteHistoryMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { ids?: string[]; status?: string }) =>
      api.batchDeleteHistory(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.history });
    },
  });
}

export type { HistoryEntry };
