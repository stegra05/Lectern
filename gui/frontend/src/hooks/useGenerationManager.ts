import { useCallback } from 'react';
import { useLecternStore } from '../store';

/**
 * Facade hook for the generation flow.
 * Wraps the existing SSE streaming logic in a clean API.
 * Keeps SSE handling in Zustand (correct for continuous streams).
 */
export function useGenerationManager() {
  const store = useLecternStore();

  // Start generation
  const startGeneration = useCallback(() => {
    store.handleGenerate();
  }, [store]);

  // Cancel generation
  const cancelGeneration = useCallback(() => {
    store.handleCancel();
  }, [store]);

  // Reset to dashboard
  const reset = useCallback(() => {
    store.handleReset();
  }, [store]);

  // Load a previous session
  const loadSession = useCallback(
    (sessionId: string) => {
      store.loadSession(sessionId);
    },
    [store]
  );

  return {
    // Generation state
    step: store.step,
    pdfFile: store.pdfFile,
    deckName: store.deckName,
    focusPrompt: store.focusPrompt,
    targetDeckSize: store.targetDeckSize,
    progress: store.progress,
    currentPhase: store.currentPhase,
    logs: store.logs,
    isError: store.isError,
    isCancelling: store.isCancelling,
    estimation: store.estimation,
    isEstimating: store.isEstimating,
    estimationError: store.estimationError,
    totalPages: store.totalPages,
    coverageData: store.coverageData,
    conceptProgress: store.conceptProgress,

    // Session state
    sessionId: store.sessionId,
    isHistorical: store.isHistorical,

    // Setup state
    densityPreferences: store.densityPreferences,

    // Actions
    setPdfFile: store.setPdfFile,
    setDeckName: store.setDeckName,
    setFocusPrompt: store.setFocusPrompt,
    setTargetDeckSize: store.setTargetDeckSize,
    setEstimation: store.setEstimation,
    setEstimationError: store.setEstimationError,
    setIsEstimating: store.setIsEstimating,
    recommendTargetDeckSize: store.recommendTargetDeckSize,

    // Generation actions
    startGeneration,
    cancelGeneration,
    reset,
    loadSession,

    // Utility
    handleCopyLogs: store.handleCopyLogs,
    recoverSessionOnRefresh: store.recoverSessionOnRefresh,
  };
}
