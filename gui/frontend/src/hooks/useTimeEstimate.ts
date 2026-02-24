import { useRef, useState, useEffect, useMemo } from 'react';

type Phase = 'concept' | 'generating' | 'reflecting' | 'complete' | 'idle';

interface TimeEstimateResult {
    /** Formatted time estimate string like "About 45s remaining" or "~2 min left" */
    formatted: string | null;
    /** Estimated seconds remaining (null if not enough data) */
    secondsRemaining: number | null;
    /** Confidence level: low (< 10%), medium (10-30%), high (> 30%) */
    confidence: 'low' | 'medium' | 'high';
    /** Cards per minute rate during generating phase */
    cardsPerMinute: number | null;
}

// Null estimate for idle/complete phases
const NULL_ESTIMATE: TimeEstimateResult = {
    formatted: null,
    secondsRemaining: null,
    confidence: 'low',
    cardsPerMinute: null,
};

/**
 * Hook to estimate remaining time based on overall progress percentage.
 *
 * Uses a simple but effective rate-based calculation:
 * - Tracks elapsed time since generation started
 * - Calculates rate from overall progress percentage
 * - Applies exponential smoothing for stable estimates
 *
 * @param currentPhase - The current generation phase
 * @param overallProgress - Overall progress percentage (0-100)
 * @param cardsGenerated - Number of cards generated so far
 * @param totalCards - Total expected cards (from progress.total)
 * @returns Time estimate with formatted string and confidence level
 */
export function useTimeEstimate(
    currentPhase: Phase,
    overallProgress: number,
    cardsGenerated: number,
    totalCards: number
): TimeEstimateResult {
    // Track generation start time
    const generationStartTimeRef = useRef<number | null>(null);

    // Track previous phase for detecting transitions
    const prevPhaseRef = useRef<Phase>(currentPhase);

    // Exponential smoothing for rate (prevents wild fluctuations)
    const smoothedRateRef = useRef<number>(0);

    // State for the estimate result
    const [estimate, setEstimate] = useState<TimeEstimateResult>(NULL_ESTIMATE);

    // Track phase transitions to reset start time
    useEffect(() => {
        if (currentPhase !== prevPhaseRef.current) {
            // Reset start time when entering a new active phase
            if (currentPhase !== 'idle' && currentPhase !== 'complete') {
                if (generationStartTimeRef.current === null) {
                    generationStartTimeRef.current = Date.now();
                }
            }
            prevPhaseRef.current = currentPhase;
        }
    }, [currentPhase]);

    // Initialize start time when first entering an active phase
    useEffect(() => {
        if (currentPhase !== 'idle' && currentPhase !== 'complete' && generationStartTimeRef.current === null) {
            generationStartTimeRef.current = Date.now();
        }
    }, [currentPhase]);

    // Update estimate periodically
    useEffect(() => {
        // Skip calculation for idle/complete phases
        if (currentPhase === 'idle' || currentPhase === 'complete') {
            return;
        }

        const calculateEstimate = (): TimeEstimateResult => {
            const startTime = generationStartTimeRef.current;
            if (!startTime) {
                return NULL_ESTIMATE;
            }

            const elapsed = Date.now() - startTime;
            const elapsedSeconds = elapsed / 1000;

            // Need at least 3 seconds and 2% progress for meaningful estimates
            if (overallProgress < 2 || elapsedSeconds < 3) {
                return {
                    formatted: 'Calculating...',
                    secondsRemaining: null,
                    confidence: 'low',
                    cardsPerMinute: null,
                };
            }

            // Rate-based calculation: if 30% done in 15s, total time = 15/0.30 = 50s
            const progressFraction = overallProgress / 100;
            const estimatedTotalMs = elapsed / progressFraction;
            const remainingMs = estimatedTotalMs - elapsed;
            let secondsRemaining = Math.round(remainingMs / 1000);

            // Apply exponential smoothing to the remaining time estimate
            // This prevents the estimate from jumping around
            if (smoothedRateRef.current > 0) {
                const currentRate = 1 / secondsRemaining; // progress per second
                const smoothedRate = 0.7 * smoothedRateRef.current + 0.3 * currentRate;
                smoothedRateRef.current = smoothedRate;
                secondsRemaining = Math.round(1 / smoothedRate);
            } else {
                smoothedRateRef.current = 1 / secondsRemaining;
            }

            // Clamp to reasonable range (1 second to 10 minutes)
            secondsRemaining = Math.max(1, Math.min(secondsRemaining, 600));

            // Calculate cards per minute (only meaningful during generating phase)
            let cardsPerMinute: number | null = null;
            if (currentPhase === 'generating' && cardsGenerated > 0 && elapsedSeconds > 5) {
                cardsPerMinute = (cardsGenerated / elapsedSeconds) * 60;
            }

            // Confidence based on overall progress
            let confidence: 'low' | 'medium' | 'high';
            if (overallProgress < 10) {
                confidence = 'low';
            } else if (overallProgress < 30) {
                confidence = 'medium';
            } else {
                confidence = 'high';
            }

            // Format the time estimate
            let formatted: string;
            if (secondsRemaining < 60) {
                formatted = `About ${secondsRemaining}s remaining`;
            } else {
                const minutes = Math.round(secondsRemaining / 60);
                formatted = `About ${minutes} min remaining`;
            }

            // Add rate info for generating phase with high confidence
            if (currentPhase === 'generating' && cardsPerMinute !== null && confidence !== 'low') {
                const rateStr = cardsPerMinute >= 1
                    ? `${cardsPerMinute.toFixed(1)} cards/min`
                    : `${Math.round(cardsPerMinute * 60)} cards/hr`;
                formatted = `${rateStr} • ${formatted}`;
            }

            return { formatted, secondsRemaining, confidence, cardsPerMinute };
        };

        // Initial calculation
        setEstimate(calculateEstimate());

        // Update every second
        const interval = setInterval(() => {
            setEstimate(calculateEstimate());
        }, 1000);

        return () => clearInterval(interval);
    }, [currentPhase, overallProgress, cardsGenerated, totalCards]);

    // Return null estimate for idle/complete phases, otherwise return the calculated estimate
    return useMemo(() => {
        if (currentPhase === 'idle' || currentPhase === 'complete') {
            return NULL_ESTIMATE;
        }
        return estimate;
    }, [currentPhase, estimate]);
}

/**
 * Format seconds into a human-readable string.
 */
export function formatTime(seconds: number): string {
    if (seconds < 60) {
        return `${seconds}s`;
    } else if (seconds < 3600) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
    } else {
        const hours = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }
}
