import { useEffect, useRef } from 'react';
import { useLecternStore } from '../store';
import { api } from '../api';
import { extractBase, recomputeCost, type EstimationBase } from '../utils/recompute';
import type { HealthStatus } from '../hooks/useAppState';

export function useEstimationLogic(health: HealthStatus | null) {
    const pdfFile = useLecternStore(s => s.pdfFile);
    const targetDeckSize = useLecternStore(s => s.targetDeckSize);
    const estimation = useLecternStore(s => s.estimation);
    const setIsEstimating = useLecternStore(s => s.setIsEstimating);
    const setEstimation = useLecternStore(s => s.setEstimation);
    const setEstimationError = useLecternStore(s => s.setEstimationError);
    const recommendTargetDeckSize = useLecternStore(s => s.recommendTargetDeckSize);

    // NOTE(Estimation): Cache base data from initial estimate for instant slider recompute.
    const estimationBaseRef = useRef<EstimationBase | null>(null);
    const previousEstimateContextRef = useRef<string | null>(null);

    // Effect 1: Initial estimate — fires on PDF change only.
    useEffect(() => {
        const controller = new AbortController();
        estimationBaseRef.current = null;

        const fetchEstimate = async () => {
            if (!pdfFile) {
                setEstimation(null);
                setIsEstimating(false);
                return;
            }
            setIsEstimating(true);
            setEstimationError(null);
            try {
                const est = await api.estimateCost(
                    pdfFile,
                    health?.gemini_model,
                    undefined, // No target_card_count — use backend default for initial estimate
                    controller.signal
                );
                if (!controller.signal.aborted && est) {
                    estimationBaseRef.current = extractBase(est);
                    setEstimation(est);
                }
            } catch (e) {
                if ((e as Error).name !== 'AbortError') {
                    console.error(e);
                    if (!controller.signal.aborted) {
                        setEstimation(null);
                        const msg = (e as Error).message || 'Estimation failed';
                        setEstimationError(
                            msg.includes('500') ? 'Estimation failed — check your Gemini API key in Settings.' : `Estimation failed: ${msg}`
                        );
                    }
                }
            } finally {
                if (!controller.signal.aborted) {
                    setIsEstimating(false);
                }
            }
        };
        fetchEstimate();
        return () => controller.abort();
    }, [pdfFile, health?.gemini_model, setEstimation, setIsEstimating, setEstimationError]);

    // Effect 2: Slider recompute — instant client-side math, no loading state.
    useEffect(() => {
        const base = estimationBaseRef.current;
        if (!base) return;

        const updated = recomputeCost(base, targetDeckSize);
        setEstimation(updated);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [targetDeckSize]);

    // Effect 3: Recommend default target deck size based on context 
    useEffect(() => {
        if (!pdfFile) {
            previousEstimateContextRef.current = null;
            return;
        }
        if (estimation?.suggested_card_count === undefined) return;

        const contextKey = `${pdfFile.name}:${pdfFile.size}:${pdfFile.lastModified}`;
        if (previousEstimateContextRef.current !== contextKey) {
            recommendTargetDeckSize(estimation);
            previousEstimateContextRef.current = contextKey;
        }
    }, [pdfFile, estimation, recommendTargetDeckSize]);
}
