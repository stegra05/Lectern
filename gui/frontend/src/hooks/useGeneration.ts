import { useState, useMemo } from 'react';
import { type ProgressEvent, type Card, type Estimation } from '../api';
import type { Phase } from '../components/PhaseIndicator';
import type { Step } from './useAppState';
import { useGenerationFlow } from './useGenerationFlow';
import { useCardManager } from './useCardManager';
import { type SortOption } from './types';

export type { SortOption };

export function useGeneration(setStep: (step: Step) => void, modelName?: string) {
  // Global States Owned by Main Hook
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [deckName, setDeckName] = useState('');
  const [focusPrompt, setFocusPrompt] = useState<string>('');
  const [logs, setLogs] = useState<ProgressEvent[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [estimation, setEstimation] = useState<Estimation | null>(null);
  const [isEstimating, setIsEstimating] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isError, setIsError] = useState(false);
  const [currentPhase, setCurrentPhase] = useState<Phase>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isHistorical, setIsHistorical] = useState(false);
  const [previewSlide, setPreviewSlide] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const [sourceType, setSourceType] = useState<'auto' | 'slides' | 'script'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('sourceType') as 'auto' | 'slides' | 'script') || 'auto';
    }
    return 'auto';
  });

  const [densityTarget, setDensityTarget] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('densityTarget');
      return stored ? parseFloat(stored) : 1.5;
    }
    return 1.5;
  });

  // Flow Sub-hook
  // MEMOIZED setters to prevent infinite loop in useGenerationFlow's useEffect
  const setters = useMemo(() => ({
    setStep, setLogs, setProgress, setSessionId, setCards, setCurrentPhase,
    setIsError, setIsCancelling, setEstimation, setIsEstimating
  }), [setStep]);

  const flow = useGenerationFlow(
    { pdfFile, deckName, focusPrompt, sourceType, densityTarget, sessionId, modelName },
    setters
  );

  // Manager Sub-hook
  const manager = useCardManager(
    { sessionId, isHistorical, cards, deckName },
    { setCards, setDeckName, setSessionId, setIsHistorical, setStep, setCurrentPhase }
  );

  const handleReset = () => {
    setStep('dashboard');
    setPdfFile(null);
    setDeckName('');
    setFocusPrompt('');
    setLogs([]);
    setCards([]);
    setCopied(false);
    setProgress({ current: 0, total: 0 });
    setIsCancelling(false);
    setIsError(false);
    setCurrentPhase('idle');
    setSessionId(null);
    setIsHistorical(false);
    // Manager local states are reset implicitly if we clear sessionId, 
    // but better to have explicit reset for its internal state if needed.
    manager.setEditingIndex(null);
    manager.setEditForm(null);
    manager.setIsSyncing(false);
    manager.setSyncSuccess(false);
    manager.setSyncLogs([]);
    manager.setConfirmModal({ isOpen: false, type: 'lectern', index: -1 });
  };

  return {
    pdfFile, setPdfFile,
    deckName, setDeckName,
    logs,
    cards, setCards,
    progress,
    estimation,
    isEstimating,
    previewSlide, setPreviewSlide,
    isCancelling,
    isError,
    currentPhase,
    sessionId,
    isHistorical,
    focusPrompt, setFocusPrompt,
    sourceType, setSourceType: (type: 'auto' | 'slides' | 'script') => {
      setSourceType(type);
      localStorage.setItem('sourceType', type);
    },
    densityTarget, setDensityTarget: (target: number) => {
      setDensityTarget(target);
      localStorage.setItem('densityTarget', String(target));
    },
    handleGenerate: flow.handleGenerate,
    handleReset,
    handleCancel: flow.handleCancel,
    loadSession: manager.loadSession,
    logsEndRef: flow.logsEndRef,
    handleCopyLogs: () => {
      const text = logs.map(l => `[${new Date(l.timestamp * 1000).toLocaleTimeString()}] ${l.type.toUpperCase()}: ${l.message}`).join('\n');
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    },
    copied,
    sortBy: manager.sortBy,
    setSortBy: manager.setSortBy,
    searchQuery: manager.searchQuery, setSearchQuery: manager.setSearchQuery,

    /* Edit & Sync Exports */
    editingIndex: manager.editingIndex, setEditingIndex: manager.setEditingIndex,
    editForm: manager.editForm, setEditForm: manager.setEditForm,
    isSyncing: manager.isSyncing, setIsSyncing: manager.setIsSyncing,
    syncSuccess: manager.syncSuccess,
    syncProgress: manager.syncProgress, setSyncProgress: manager.setSyncProgress,
    syncLogs: manager.syncLogs, setSyncLogs: manager.setSyncLogs,
    confirmModal: manager.confirmModal, setConfirmModal: manager.setConfirmModal,

    handleDelete: manager.handleDelete,
    handleAnkiDelete: manager.handleAnkiDelete,
    startEdit: manager.startEdit,
    cancelEdit: manager.cancelEdit,
    saveEdit: manager.saveEdit,
    handleFieldChange: manager.handleFieldChange,
    handleSync: manager.handleSync
  };
}
