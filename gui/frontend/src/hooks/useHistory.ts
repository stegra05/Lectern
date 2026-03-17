import { useEffect } from 'react';
import { useHistoryQuery, useDeleteHistoryMutation, useClearHistoryMutation, useBatchDeleteHistoryMutation } from '../queries';
import type { Step } from '../store-types';

export function useHistory(step: Step) {
  // React Query hooks
  const { data: history, isLoading, refetch } = useHistoryQuery();
  const deleteMutation = useDeleteHistoryMutation();
  const clearMutation = useClearHistoryMutation();
  const batchDeleteMutation = useBatchDeleteHistoryMutation();

  // Refresh history when entering specific states
  useEffect(() => {
    if (step === 'done' || step === 'dashboard') {
      refetch();
    }
  }, [step, refetch]);

  const clearAllHistory = async () => {
    await clearMutation.mutateAsync();
  };

  const deleteHistoryEntry = async (id: string) => {
    await deleteMutation.mutateAsync(id);
  };

  const batchDeleteHistory = async (params: { ids?: string[]; status?: string }) => {
    await batchDeleteMutation.mutateAsync(params);
  };

  const refreshHistory = async () => {
    await refetch();
  };

  return {
    history,
    isLoading,
    clearAllHistory,
    deleteHistoryEntry,
    batchDeleteHistory,
    refreshHistory
  };
}
