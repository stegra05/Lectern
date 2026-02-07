import { useState, useEffect, useRef } from 'react';
import { api, type ProgressEvent } from '../api';
import type { Phase } from '../components/PhaseIndicator';
import type { Step } from './useAppState';

export interface Card {
  front: string;
  back: string;
  tag?: string;
  tags?: string[];
  model_name?: string;
  fields?: Record<string, string>;
  slide_number?: number;
  slide_topic?: string;
  anki_note_id?: number;
}

export type SortOption = 'creation' | 'topic' | 'slide' | 'type';

export function useGeneration(setStep: (step: Step) => void) {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [deckName, setDeckName] = useState('');
  const [logs, setLogs] = useState<ProgressEvent[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [estimation, setEstimation] = useState<{ tokens: number, cost: number } | null>(null);
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
  const [editForm, setEditForm] = useState<any>(null);
  const [isSyncing, setIsSyncing] = useState(false);
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
      return (localStorage.getItem('sourceType') as any) || 'auto';
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
        const est = await api.estimateCost(pdfFile, controller.signal);
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
  }, [pdfFile]);

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
            setSessionId(event.data?.session_id ?? null);
          } else if (event.type === 'progress_start') {
            setProgress({ current: 0, total: event.data.total });
          } else if (event.type === 'progress_update') {
            setProgress(prev => ({ ...prev, current: event.data.current }));
          } else if (event.type === 'card_generated') {
            setCards(prev => [event.data.card, ...prev]);
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
    syncProgress, setSyncProgress,
    syncLogs, setSyncLogs,
    confirmModal, setConfirmModal,

    handleDelete: async (index: number) => {
      try {
        const newCards = [...cards];
        newCards.splice(index, 1);

        if (isHistorical && sessionId) {
          // For historical sessions, we use deleteSessionCard for single deletions
          // to ensure history count is updated correctly foundationally
          await api.deleteSessionCard(sessionId, index);

          // We also update the specific card list state via re-fetch or manual update
          // Re-fetching is safer but manual update is faster
          // Let's manually update the local state which we already did above
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
        if (newCards[index] && (newCards[index] as any).anki_note_id === noteId) {
          delete (newCards[index] as any).anki_note_id;
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
        const newCards = [...cards];
        newCards[index] = editForm;

        if (isHistorical && sessionId) {
          await api.updateSessionCards(sessionId, newCards);
        } else {
          await api.updateDraft(index, editForm, sessionId ?? undefined);
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
      setEditForm({
        ...editForm,
        fields: {
          ...editForm.fields,
          [field]: value
        }
      });
    },

    handleSync: async (onComplete: () => void) => {
      setIsSyncing(true);
      setSyncLogs([]);
      try {
        const syncFn = isHistorical && sessionId
          ? (cb: any) => api.syncSessionToAnki(sessionId, cb)
          : (cb: any) => api.syncDrafts(cb, sessionId ?? undefined);

        await syncFn((event: any) => {
          setSyncLogs(prev => [...prev, event]);
          if (event.type === 'progress_start') {
            setSyncProgress({ current: 0, total: event.data.total });
          } else if (event.type === 'progress_update') {
            setSyncProgress(prev => ({ ...prev, current: event.data.current }));
          } else if (event.type === 'done') {
            onComplete();
          }
        });
      } catch (e) {
        console.error("Sync failed", e);
        setIsSyncing(false);
      }
    }
  };
}
