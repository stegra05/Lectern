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
    if (confirm('Are you sure you want to clear all history?')) {
      await api.clearHistory();
      setHistory([]);
    }
  };

  const deleteHistoryEntry = async (id: string) => {
    if (confirm('Delete this session?')) {
      await api.deleteHistoryEntry(id);
      setHistory(prev => prev.filter(h => h.id !== id));
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
    refreshHistory
  };
}
