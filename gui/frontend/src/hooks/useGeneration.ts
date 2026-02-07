import { useState, useEffect, useRef } from 'react';
import { api, type ProgressEvent, type Card, type Estimation } from '../api';
import type { Phase } from '../components/PhaseIndicator';
import type { Step } from './useAppState';

export type SortOption = 'creation' | 'topic' | 'slide' | 'type';

export function useGeneration(setStep: (step: Step) => void, modelName?: string) {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [deckName, setDeckName] = useState('');
  const [logs, setLogs] = useState<ProgressEvent[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [estimation, setEstimation] = useState<Estimation | null>(null);
  const [isEstimating, setIsEstimating] = useState(false);
  const [previewSlide, setPreviewSlide] = useState<number | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isError, setIsError] = useState(false);
  const [currentPhase, setCurrentPhase] = useState<Phase>('idle');
  const [copied, setCopied] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isHistorical, setIsHistorical] = useState(false);

  /* Edit & Sync State */
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Card | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ current: 0, total: 0 });
  const [syncLogs, setSyncLogs] = useState<ProgressEvent[]>([]);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    type: 'lectern' | 'anki';
    index: number;
    noteId?: number;
  }>({ isOpen: false, type: 'lectern', index: -1 });

  /* New Focus Prompt State */
  const [focusPrompt, setFocusPrompt] = useState<string>('');

  const [sourceType, setSourceType] = useState<'auto' | 'slides' | 'script'>(() => {
    // Persist source type preference
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('sourceType') as 'auto' | 'slides' | 'script') || 'auto';
    }
    return 'auto';
  });

  const [densityTarget, setDensityTarget] = useState<number>(() => {
    // Persist density preference
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('densityTarget');
      return stored ? parseFloat(stored) : 1.5;
    }
    return 1.5;
  });

  /* Search State */
  const [searchQuery, setSearchQuery] = useState('');

  const [sortBy, setSortBy] = useState<SortOption>(() => {
    // Persist sorting preference
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('cardSortBy') as SortOption) || 'creation';
    }
    return 'creation';
  });

  const logsEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Estimation effect
  useEffect(() => {
    const controller = new AbortController();

    const fetchEstimate = async () => {
      if (!pdfFile) {
        setEstimation(null);
        setIsEstimating(false);  // Reset stuck state when file cleared
        return;
      }
      setIsEstimating(true);
      try {
        const est = await api.estimateCost(pdfFile, modelName, controller.signal);
        if (est) setEstimation(est);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          console.error(e);
          setEstimation(null);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsEstimating(false);
        }
      }
    };

    fetchEstimate();
    return () => controller.abort();
  }, [pdfFile, modelName]);

  const handleReset = () => {
    setStep('dashboard');
    setPdfFile(null);
    setDeckName('');
    setFocusPrompt('');
    setLogs([]);
    setCards([]);
    setProgress({ current: 0, total: 0 });
    setIsCancelling(false);
    setIsError(false);
    setCurrentPhase('idle');
    setSessionId(null);
    setIsHistorical(false);
    setEditingIndex(null);
    setEditForm(null);
    setIsSyncing(false);
    setSyncSuccess(false);
    setSyncLogs([]);
    setConfirmModal({ isOpen: false, type: 'lectern', index: -1 });
  };

  const handleGenerate = async () => {
    if (!pdfFile || !deckName) return;
    setStep('generating');
    setLogs([]);
    setCards([]);
    setSessionId(null);
    setIsHistorical(false);
    setIsError(false);

    try {
      await api.generate(
        {
          pdf_file: pdfFile,
          deck_name: deckName,
          focus_prompt: focusPrompt,
          source_type: sourceType,
          density_target: densityTarget
        },
        (event) => {
          setLogs(prev => [...prev, event]);
          if (event.type === 'session_start') {
            setSessionId(event.data && typeof event.data === 'object' && 'session_id' in event.data ? (event.data as { session_id: string }).session_id : null);
          } else if (event.type === 'progress_start') {
            setProgress({ current: 0, total: (event.data as { total: number }).total });
          } else if (event.type === 'progress_update') {
            setProgress(prev => ({ ...prev, current: (event.data as { current: number }).current }));
          } else if (event.type === 'card_generated') {
            setCards(prev => [...prev, (event.data as { card: Card }).card]);
          } else if (event.type === 'step_start') {
            if (event.message.includes('concept map')) {
              setCurrentPhase('concept');
            } else if (event.message.includes('Generate cards')) {
              setCurrentPhase('generating');
            } else if (event.message.includes('Reflection')) {
              setCurrentPhase('reflecting');
            }
          } else if (event.type === 'done') {
            setStep('done');
            setCurrentPhase('complete');
          } else if (event.type === 'cancelled') {
            handleReset();
          } else if (event.type === 'error') {
            setIsError(true);
          }
        }
      );
    } catch (e) {
      console.error(e);
      setLogs(prev => [...prev, { type: 'error', message: 'Network error', timestamp: Date.now() }]);
      setIsError(true);
    }
  };

  const handleCopyLogs = () => {
    const text = logs.map(l => `[${new Date(l.timestamp * 1000).toLocaleTimeString()}] ${l.type.toUpperCase()}: ${l.message}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCancel = () => {
    setIsCancelling(true);
    api.stopGeneration(sessionId ?? undefined);
    // Return to dashboard immediately for better UX
    setTimeout(() => handleReset(), 500);
  };

  const loadSession = async (sid: string) => {
    try {
      setStep('generating'); // Show progress view while loading if needed, or just jump to review
      const session = await api.getSession(sid);
      setCards(session.cards || []);
      setDeckName(session.deck_name || '');
      setSessionId(sid);
      setIsHistorical(true);
      setStep('done');
      setCurrentPhase('complete');
    } catch (e) {
      console.error('Failed to load session:', e);
      // Fallback to dashboard if load fails
      setStep('dashboard');
    }
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
    handleGenerate,
    handleReset,
    handleCancel,
    loadSession,
    logsEndRef,
    handleCopyLogs,
    copied,
    sortBy,
    setSortBy: (opt: SortOption) => {
      setSortBy(opt);
      localStorage.setItem('cardSortBy', opt);
    },
    searchQuery, setSearchQuery,

    /* Edit & Sync Exports */
    editingIndex, setEditingIndex,
    editForm, setEditForm,
    isSyncing, setIsSyncing,
    syncSuccess,
    syncProgress, setSyncProgress,
    syncLogs, setSyncLogs,
    confirmModal, setConfirmModal,

    handleDelete: async (index: number) => {
      try {
        const newCards = [...cards];
        newCards.splice(index, 1);

        if (isHistorical && sessionId) {
          await api.deleteSessionCard(sessionId, index);
        } else {
          await api.deleteDraft(index, sessionId ?? undefined);
        }

        setCards(newCards);
        setConfirmModal({ ...confirmModal, isOpen: false });
      } catch (e) {
        console.error("Failed to delete card", e);
      }
    },

    handleAnkiDelete: async (noteId: number, index: number) => {
      try {
        await api.deleteAnkiNotes([noteId]);
        // Clear anki_note_id from card but keep card
        const newCards = [...cards];
        if (newCards[index] && newCards[index].anki_note_id === noteId) {
          delete newCards[index].anki_note_id;
          if (isHistorical && sessionId) {
            await api.updateSessionCards(sessionId, newCards);
          } else {
            await api.updateDraft(index, newCards[index], sessionId ?? undefined);
          }
          setCards(newCards);
        }
        setConfirmModal({ ...confirmModal, isOpen: false });
      } catch (e) {
        console.error("Failed to delete Anki note", e);
      }
    },

    startEdit: (index: number) => {
      setEditingIndex(index);
      setEditForm(JSON.parse(JSON.stringify(cards[index]))); // Deep copy
    },

    cancelEdit: () => {
      setEditingIndex(null);
      setEditForm(null);
    },

    saveEdit: async (index: number) => {
      try {
        if (!editForm) return;
        const newCards = [...cards];
        newCards[index] = editForm;

        // Save to Lectern
        if (isHistorical && sessionId) {
          await api.updateSessionCards(sessionId, newCards);
        } else {
          await api.updateDraft(index, editForm, sessionId ?? undefined);
        }

        // If synced to Anki, also update Anki
        if (editForm.anki_note_id && editForm.fields) {
          const stringFields: Record<string, string> = {};
          for (const [k, v] of Object.entries(editForm.fields)) {
            stringFields[k] = String(v);
          }
          await api.updateAnkiNote(editForm.anki_note_id, stringFields);
        }

        setCards(newCards);
        setEditingIndex(null);
        setEditForm(null);
      } catch (e) {
        console.error("Failed to update card", e);
      }
    },

    handleFieldChange: (field: string, value: string) => {
      if (!editForm) return;
      if (editForm.fields && typeof editForm.fields === 'object') {
        setEditForm({
          ...editForm,
          fields: {
            ...editForm.fields,
            [field]: value
          }
        });
      } else {
        setEditForm({
          ...editForm,
          fields: { [field]: value }
        });
      }
    },

    handleSync: async (onComplete: () => void) => {
      setIsSyncing(true);
      setSyncSuccess(false);
      setSyncLogs([]);
      try {
        const syncFn = isHistorical && sessionId
          ? (cb: (event: ProgressEvent) => void) => api.syncSessionToAnki(sessionId, cb)
          : (cb: (event: ProgressEvent) => void) => api.syncDrafts(cb, sessionId ?? undefined);

        await syncFn(async (event: ProgressEvent) => {
          setSyncLogs(prev => [...prev, event]);
          if (event.type === 'progress_start') {
            setSyncProgress({ current: 0, total: (event.data as { total: number }).total });
          } else if (event.type === 'progress_update') {
            setSyncProgress(prev => ({ ...prev, current: (event.data as { current: number }).current }));
          } else if (event.type === 'done') {
            // Refetch cards from backend to get updated anki_note_id values
            try {
              if (isHistorical && sessionId) {
                const session = await api.getSession(sessionId);
                setCards(session.cards || []);
              } else if (sessionId) {
                const drafts = await api.getDrafts(sessionId);
                setCards(drafts.cards || []);
              }
            } catch (refreshErr) {
              console.error("Failed to refresh cards after sync:", refreshErr);
            }
            onComplete();
            setSyncSuccess(true);
            setTimeout(() => setSyncSuccess(false), 3000);
          }
        });
      } catch (e) {
        console.error("Sync failed", e);
      } finally {
        setIsSyncing(false);
      }
    }
  };
}
