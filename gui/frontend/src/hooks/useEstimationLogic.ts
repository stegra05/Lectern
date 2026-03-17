import { useEffect, useRef } from 'react';
import { useLecternStore } from '../store';
import { useEstimationQuery } from '../queries';
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

    const estimateQuery = useEstimationQuery({
        file: pdfFile,
        modelName: health?.gemini_model,
    });

    // Effect 1: Sync query state into store state consumed by existing UI logic.
    useEffect(() => {
        if (!pdfFile) {
            estimationBaseRef.current = null;
            setEstimation(null);
            setEstimationError(null);
            setIsEstimating(false);
            return;
        }

        setIsEstimating(estimateQuery.isLoading || estimateQuery.isFetching);

        if (estimateQuery.error) {
            const msg = (estimateQuery.error as Error).message || 'Estimation failed';
            setEstimation(null);
            setEstimationError(
                msg.includes('500')
                    ? 'Estimation failed — check your Gemini API key in Settings.'
                    : `Estimation failed: ${msg}`
            );
            return;
        }

        if (estimateQuery.data) {
            estimationBaseRef.current = extractBase(estimateQuery.data);
            setEstimationError(null);
            setEstimation(estimateQuery.data);
        }
    }, [
        estimateQuery.data,
        estimateQuery.error,
        estimateQuery.isFetching,
        estimateQuery.isLoading,
        pdfFile,
        setEstimation,
        setEstimationError,
        setIsEstimating,
    ]);

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
