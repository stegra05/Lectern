import { useRef, useState, useEffect, useMemo } from 'react';

type Phase = 'concept' | 'generating' | 'reflecting' | 'complete' | 'idle';

interface TimeEstimateResult {
    /** Formatted time estimate string like "About 45s remaining" or "~2 min left" */
    formatted: string | null;
    /** Estimated seconds remaining (null if not enough data) */
    secondsRemaining: number | null;
    /** Confidence level: low (< 3 cards), medium (3-5 cards), high (> 5 cards) */
    confidence: 'low' | 'medium' | 'high';
    /** Cards per minute rate during generating phase */
    cardsPerMinute: number | null;
}

// Default phase durations (in ms) for initial estimates
const DEFAULT_PHASE_DURATIONS = {
    concept: 15000,     // 15 seconds
    generating: 60000,  // 1 minute (will be overridden by actual rate)
    reflecting: 10000,  // 10 seconds
};

// Null estimate for idle/complete phases
const NULL_ESTIMATE: TimeEstimateResult = {
    formatted: null,
    secondsRemaining: null,
    confidence: 'low',
    cardsPerMinute: null,
};

/**
 * Hook to estimate remaining time based on phase progress and card generation rate.
 *
 * @param currentPhase - The current generation phase
 * @param cardsGenerated - Number of cards generated so far
 * @param totalCards - Total expected cards (from progress.total)
 * @param phaseProgress - Progress within current phase (0-1)
 * @returns Time estimate with formatted string and confidence level
 */
export function useTimeEstimate(
    currentPhase: Phase,
    cardsGenerated: number,
    totalCards: number,
    phaseProgress: number
): TimeEstimateResult {
    // Store phase start times
    const phaseStartTimesRef = useRef({
        concept: 0,
        generating: 0,
        reflecting: 0,
    });

    // We no longer track individual card timestamps since we use time-since-phase-start
    const prevPhaseRef = useRef<Phase>(currentPhase);

    // State for the estimate result (only used during active phases)
    const [estimate, setEstimate] = useState<TimeEstimateResult>(NULL_ESTIMATE);

    // Track phase transitions
    useEffect(() => {
        if (currentPhase !== prevPhaseRef.current) {
            // Start new phase timer
            if (currentPhase && currentPhase !== 'idle' && currentPhase !== 'complete') {
                phaseStartTimesRef.current[currentPhase as 'concept' | 'generating' | 'reflecting'] = Date.now();
            }
            prevPhaseRef.current = currentPhase;
        }
    }, [currentPhase]);

    // Update estimate periodically (only for active phases)
    useEffect(() => {
        // Skip calculation for idle/complete phases
        if (currentPhase === 'idle' || currentPhase === 'complete') {
            return;
        }

        const calculateEstimate = (): TimeEstimateResult => {
            const now = Date.now();
            let secondsRemaining: number | null = null;
            let cardsPerMinute: number | null = null;
            let confidence: 'low' | 'medium' | 'high' = 'low';

            if (currentPhase === 'concept') {
                const startTime = phaseStartTimesRef.current.concept;
                if (startTime > 0) {
                    const elapsed = now - startTime;
                    if (phaseProgress > 0.1 && elapsed > 2000) {
                        const estimatedTotal = elapsed / phaseProgress;
                        secondsRemaining = Math.round((estimatedTotal - elapsed) / 1000);
                    } else {
                        secondsRemaining = Math.round((DEFAULT_PHASE_DURATIONS.concept - elapsed) / 1000);
                    }
                }
                confidence = 'low';
            } else if (currentPhase === 'generating') {
                const startTime = phaseStartTimesRef.current.generating;
                if (startTime > 0) {
                    const elapsed = now - startTime;
                    const elapsedSeconds = elapsed / 1000;

                    // Wait at least 5 seconds before calculating a rate to avoid wild initial spikes
                    if (cardsGenerated > 0 && elapsedSeconds > 5) {
                        cardsPerMinute = (cardsGenerated / elapsedSeconds) * 60;
                        const cardsLeft = Math.max(0, totalCards - cardsGenerated);

                        if (cardsPerMinute > 0) {
                            secondsRemaining = Math.round((cardsLeft / cardsPerMinute) * 60);
                        }

                        // Confidence builds as time goes on and cards are generated
                        confidence = elapsedSeconds < 15 ? 'low' : elapsedSeconds < 30 ? 'medium' : 'high';
                    }

                    // Fallback to progress-based estimate if rate calculation isn't ready
                    if (secondsRemaining === null && phaseProgress > 0.05) {
                        const estimatedTotal = elapsed / phaseProgress;
                        secondsRemaining = Math.round((estimatedTotal - elapsed) / 1000);
                        confidence = 'low';
                    }
                }
            } else if (currentPhase === 'reflecting') {
                const startTime = phaseStartTimesRef.current.reflecting;
                if (startTime > 0) {
                    const elapsed = now - startTime;
                    if (phaseProgress > 0.1) {
                        const estimatedTotal = elapsed / phaseProgress;
                        secondsRemaining = Math.round((estimatedTotal - elapsed) / 1000);
                    } else {
                        secondsRemaining = Math.round((DEFAULT_PHASE_DURATIONS.reflecting - elapsed) / 1000);
                    }
                }
                confidence = 'low';
            }

            // Clamp to reasonable range
            if (secondsRemaining !== null) {
                secondsRemaining = Math.max(1, Math.min(secondsRemaining, 600));
            }

            // Format the time estimate
            let formatted: string | null = null;
            if (secondsRemaining !== null) {
                if (secondsRemaining < 60) {
                    formatted = `About ${secondsRemaining}s remaining`;
                } else {
                    const minutes = Math.round(secondsRemaining / 60);
                    formatted = `About ${minutes} min remaining`;
                }

                if (currentPhase === 'generating' && cardsPerMinute !== null && confidence !== 'low') {
                    const rateStr = cardsPerMinute >= 1
                        ? `${cardsPerMinute.toFixed(1)} cards/min`
                        : `${Math.round(cardsPerMinute * 60)} cards/hr`;
                    formatted = `${rateStr} • ${formatted}`;
                }
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
    }, [currentPhase, cardsGenerated, totalCards, phaseProgress]);

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
