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
}

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
  const [currentPhase, setCurrentPhase] = useState<Phase>('idle');
  const [copied, setCopied] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const [examMode, setExamMode] = useState(() => {
    // Persist exam mode preference
    if (typeof window !== 'undefined') {
      return localStorage.getItem('examMode') === 'true';
    }
    return false;
  });

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

  const toggleExamMode = () => {
    setExamMode(prev => {
      const newValue = !prev;
      localStorage.setItem('examMode', String(newValue));
      return newValue;
    });
  };

  const handleReset = () => {
    setStep('dashboard');
    setPdfFile(null);
    setDeckName('');
    setLogs([]);
    setCards([]);
    setProgress({ current: 0, total: 0 });
    setIsCancelling(false);
    setCurrentPhase('idle');
    setSessionId(null);
  };

  const handleGenerate = async () => {
    if (!pdfFile || !deckName) return;
    setStep('generating');
    setLogs([]);
    setCards([]);
    setSessionId(null);

    try {
      await api.generate(
        {
          pdf_file: pdfFile,
          deck_name: deckName,
          exam_mode: examMode,
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
            setStep('review');
            setCurrentPhase('complete');
          } else if (event.type === 'cancelled') {
            handleReset();
          }
        }
      );
    } catch (e) {
      console.error(e);
      setLogs(prev => [...prev, { type: 'error', message: 'Network error', timestamp: Date.now() }]);
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
    currentPhase,
    sessionId,
    examMode, toggleExamMode,
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
    logsEndRef,
    handleCopyLogs,
    copied
  };
}
