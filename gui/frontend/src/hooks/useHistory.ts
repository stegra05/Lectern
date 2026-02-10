import { useState, useEffect } from 'react';
import { api, type HistoryEntry } from '../api';
import type { Step } from '../store';

export function useHistory(step: Step) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // Refresh history when entering specific states or on mount
  useEffect(() => {
    if (step === 'done' || step === 'dashboard') {
      api.getHistory().then(setHistory);
    }
  }, [step]);

  const clearAllHistory = async () => {
    await api.clearHistory();
    setHistory([]);
  };

  const deleteHistoryEntry = async (id: string) => {
    await api.deleteHistoryEntry(id);
    setHistory(prev => prev.filter(h => h.id !== id));
  };

  const batchDeleteHistory = async (params: { ids?: string[]; status?: string }) => {
    await api.batchDeleteHistory(params);
    if (params.status) {
      setHistory(prev => prev.filter(h => h.status !== params.status));
    } else if (params.ids) {
      const idSet = new Set(params.ids);
      setHistory(prev => prev.filter(h => !idSet.has(h.id)));
    }
  };
  
  const refreshHistory = async () => {
      const hist = await api.getHistory();
      setHistory(hist);
  };

  return {
    history,
    setHistory,
    clearAllHistory,
    deleteHistoryEntry,
    batchDeleteHistory,
    refreshHistory
  };
}
