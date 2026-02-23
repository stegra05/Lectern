import { useState, useEffect } from 'react';

export type EstimationPhase = 'idle' | 'uploading' | 'analyzing' | 'calculating' | 'done';

export function useEstimationPhase(isEstimating: boolean) {
    const [estimationPhase, setEstimationPhase] = useState<EstimationPhase>('idle');
    const [prevIsEstimating, setPrevIsEstimating] = useState(isEstimating);

    if (isEstimating !== prevIsEstimating) {
        setPrevIsEstimating(isEstimating);
        if (!isEstimating) {
            setEstimationPhase('idle');
        }
    }

    useEffect(() => {
        if (!isEstimating) return;

        const uploadTimer = setTimeout(() => {
            setEstimationPhase('uploading');
        }, 0);

        const analyzeTimer = setTimeout(() => {
            setEstimationPhase('analyzing');
        }, 500);

        const calculateTimer = setTimeout(() => {
            setEstimationPhase('calculating');
        }, 2000);

        return () => {
            clearTimeout(uploadTimer);
            clearTimeout(analyzeTimer);
            clearTimeout(calculateTimer);
        };
    }, [isEstimating]);

    return estimationPhase;
}
