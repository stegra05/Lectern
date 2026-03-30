import { useEffect, useRef } from 'react';
import { useLecternStore } from '../store';
import { useEstimationQuery } from '../queries';
import { extractBase, recomputeCost, type EstimationBase } from '../utils/recompute';
import type { HealthStatus } from '../hooks/useAppState';
import { flushPerfTelemetry } from '../lib/perfMetricsClient';

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
    const lastTelemetryStateRef = useRef<string | null>(null);

    const estimateQuery = useEstimationQuery({
        file: pdfFile,
        modelName: health?.gemini_model,
    });

    // Effect 1: Sync query state into store state consumed by existing UI logic.
    useEffect(() => {
        if (!pdfFile) {
            estimationBaseRef.current = null;
            lastTelemetryStateRef.current = null;
            setEstimation(null);
            setEstimationError(null);
            setIsEstimating(false);
            return;
        }
        const pdfContextKey = `${pdfFile.name}:${pdfFile.size}:${pdfFile.lastModified}`;

        setIsEstimating(estimateQuery.isLoading || estimateQuery.isFetching);

        if (estimateQuery.error) {
            const msg = (estimateQuery.error as Error).message || 'Estimation failed';
            setEstimation(null);
            setEstimationError(
                msg.includes('500')
                    ? 'Estimation failed — check your Gemini API key in Settings.'
                    : `Estimation failed: ${msg}`
            );
            const telemetryKey = `error:${pdfContextKey}:${msg}:${targetDeckSize}:${health?.gemini_model ?? ''}`;
            if (lastTelemetryStateRef.current !== telemetryKey) {
                lastTelemetryStateRef.current = telemetryKey;
                void flushPerfTelemetry({
                    sessionId: 'estimation',
                    complexity: {
                        card_count: estimation?.estimated_card_count,
                        target_card_count: targetDeckSize,
                        total_pages: estimation?.pages,
                        text_chars: estimation?.text_chars,
                        model: health?.gemini_model ?? estimation?.model,
                        document_type: estimation?.document_type,
                        image_count: estimation?.image_count,
                    },
                });
            }
            return;
        }

        if (estimateQuery.data) {
            estimationBaseRef.current = extractBase(estimateQuery.data);
            setEstimationError(null);
            setEstimation(estimateQuery.data);
            const telemetryKey = `done:${pdfContextKey}:${estimateQuery.data.model}:${estimateQuery.data.pages}:${estimateQuery.data.text_chars ?? 0}:${targetDeckSize}`;
            if (lastTelemetryStateRef.current !== telemetryKey) {
                lastTelemetryStateRef.current = telemetryKey;
                void flushPerfTelemetry({
                    sessionId: 'estimation',
                    complexity: {
                        card_count: estimateQuery.data.estimated_card_count,
                        target_card_count: targetDeckSize,
                        total_pages: estimateQuery.data.pages,
                        text_chars: estimateQuery.data.text_chars,
                        model: estimateQuery.data.model || health?.gemini_model,
                        document_type: estimateQuery.data.document_type,
                        image_count: estimateQuery.data.image_count,
                    },
                });
            }
        }
    }, [
        estimation,
        estimateQuery.data,
        estimateQuery.error,
        estimateQuery.isFetching,
        estimateQuery.isLoading,
        health?.gemini_model,
        pdfFile,
        setEstimation,
        setEstimationError,
        setIsEstimating,
        targetDeckSize,
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
