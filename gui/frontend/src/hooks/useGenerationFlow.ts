import { useEffect, useRef } from 'react';
import { api, type ProgressEvent, type Card, type Estimation } from '../api';
import type { Phase } from '../components/PhaseIndicator';
import type { Step } from './useAppState';

interface FlowState {
    pdfFile: File | null;
    deckName: string;
    focusPrompt: string;
    sourceType: 'auto' | 'slides' | 'script';
    densityTarget: number;
    sessionId: string | null;
    modelName?: string;
}

interface FlowSetters {
    setStep: (step: Step) => void;
    setLogs: React.Dispatch<React.SetStateAction<ProgressEvent[]>>;
    setProgress: React.Dispatch<React.SetStateAction<{ current: number; total: number }>>;
    setSessionId: (id: string | null) => void;
    setCards: React.Dispatch<React.SetStateAction<Card[]>>;
    setCurrentPhase: (phase: Phase) => void;
    setIsError: (err: boolean) => void;
    setIsCancelling: (canc: boolean) => void;
    setEstimation: (est: Estimation | null) => void;
    setIsEstimating: (est: boolean) => void;
}

export function useGenerationFlow(state: FlowState, setters: FlowSetters) {
    const logsEndRef = useRef<HTMLDivElement>(null);

    // Estimation effect
    useEffect(() => {
        const controller = new AbortController();
        const fetchEstimate = async () => {
            if (!state.pdfFile) {
                setters.setEstimation(null);
                setters.setIsEstimating(false);
                return;
            }
            setters.setIsEstimating(true);
            try {
                const est = await api.estimateCost(state.pdfFile, state.modelName, controller.signal);
                if (est) setters.setEstimation(est);
            } catch (e) {
                if ((e as Error).name !== 'AbortError') {
                    console.error(e);
                    setters.setEstimation(null);
                }
            } finally {
                if (!controller.signal.aborted) {
                    setters.setIsEstimating(false);
                }
            }
        };
        fetchEstimate();
        return () => controller.abort();
    }, [state.pdfFile, state.modelName, setters]);

    const handleGenerate = async () => {
        if (!state.pdfFile || !state.deckName) return;
        setters.setStep('generating');
        setters.setLogs([]);
        setters.setSessionId(null);
        setters.setIsError(false);

        try {
            await api.generate(
                {
                    pdf_file: state.pdfFile,
                    deck_name: state.deckName,
                    focus_prompt: state.focusPrompt,
                    source_type: state.sourceType,
                    density_target: state.densityTarget
                },
                (event) => {
                    setters.setLogs(prev => [...prev, event]);
                    if (event.type === 'session_start') {
                        const sid = event.data && typeof event.data === 'object' && 'session_id' in event.data
                            ? (event.data as { session_id: string }).session_id
                            : null;
                        setters.setSessionId(sid);
                    } else if (event.type === 'progress_start') {
                        setters.setProgress({ current: 0, total: (event.data as { total: number }).total });
                    } else if (event.type === 'progress_update') {
                        setters.setProgress(prev => ({ ...prev, current: (event.data as { current: number }).current }));
                    } else if (event.type === 'card_generated') {
                        setters.setCards(prev => [...prev, (event.data as { card: Card }).card]);
                    } else if (event.type === 'step_start') {
                        if (event.message.includes('concept map')) {
                            setters.setCurrentPhase('concept');
                        } else if (event.message.includes('Generate cards')) {
                            setters.setCurrentPhase('generating');
                        } else if (event.message.includes('Reflection')) {
                            setters.setCurrentPhase('reflecting');
                        }
                    } else if (event.type === 'done') {
                        setters.setStep('done');
                        setters.setCurrentPhase('complete');
                    } else if (event.type === 'cancelled') {
                        // Handled by handleReset in parent
                    } else if (event.type === 'error') {
                        setters.setIsError(true);
                    }
                }
            );
        } catch (e) {
            console.error(e);
            setters.setLogs(prev => [...prev, { type: 'error', message: 'Network error', timestamp: Date.now() }]);
            setters.setIsError(true);
        }
    };

    const handleCancel = () => {
        setters.setIsCancelling(true);
        api.stopGeneration(state.sessionId ?? undefined);
    };

    return {
        handleGenerate,
        handleCancel,
        logsEndRef
    };
}
