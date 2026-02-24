import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Configuration options for the trickle progress behavior.
 */
export interface TrickleConfig {
    /** Delay before trickling starts (ms). Default: 1500 */
    startDelay: number;
    /** Interval between trickle updates (ms). Default: 200 */
    tickInterval: number;
    /** Decay factor for step calculation. Default: 0.06 */
    decayFactor: number;
    /** Minimum step size. Default: 0.05 */
    minStep: number;
    /** Maximum distance above target to trickle. Default: 5 */
    ceilingOffset: number;
    /** Maximum display percentage (to avoid reaching 100%). Default: 99 */
    maxDisplay: number;
}

export const DEFAULT_CONFIG: TrickleConfig = {
    startDelay: 1500,
    tickInterval: 200,
    decayFactor: 0.06,
    minStep: 0.05,
    ceilingOffset: 5,
    maxDisplay: 99,
};

/**
 * Smoothly interpolates progress between discrete jumps.
 *
 * When the real `targetPct` hasn't changed, the hook
 * slowly creeps the displayed value forward using a decelerating
 * curve so it never actually reaches the next expected milestone.
 *
 * @param targetPct - The actual progress percentage from the backend
 * @param config - Optional configuration overrides
 * @returns The display percentage to show
 */
export interface TrickleProgressResult {
    display: number;
    isStalled: boolean;
}

export function useTrickleProgress(
    targetPct: number,
    config: Partial<TrickleConfig> = {}
): TrickleProgressResult {
    const cfg: TrickleConfig = { ...DEFAULT_CONFIG, ...config };

    const [display, setDisplay] = useState(targetPct);
    const [isStalled, setIsStalled] = useState(false);
    const prevTarget = useRef(targetPct);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const stopAllTimers = useCallback(() => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
    }, []);

    // Track when target changes to reset display
    useEffect(() => {
        if (targetPct !== prevTarget.current) {
            prevTarget.current = targetPct;
            stopAllTimers();
            // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate: sync display with new target
            setDisplay(targetPct);
        }
    }, [targetPct, stopAllTimers]);

    // Main trickle effect
    useEffect(() => {
        // Don't trickle at boundaries
        if (targetPct >= 100 || targetPct <= 0) {
            return;
        }

        const ceiling = Math.min(targetPct + cfg.ceilingOffset, cfg.maxDisplay);

        timeoutRef.current = setTimeout(() => {
            intervalRef.current = setInterval(() => {
                setDisplay((prev) => {
                    if (prev >= ceiling) {
                        if (intervalRef.current) clearInterval(intervalRef.current);
                        return prev;
                    }
                    // Decelerate: advance by a fraction of remaining gap
                    const step = (ceiling - prev) * cfg.decayFactor;
                    return prev + Math.max(step, cfg.minStep);
                });
            }, cfg.tickInterval);
        }, cfg.startDelay);

        return () => {
            stopAllTimers();
        };
    }, [
        targetPct,
        cfg.startDelay,
        cfg.tickInterval,
        cfg.decayFactor,
        cfg.minStep,
        cfg.ceilingOffset,
        cfg.maxDisplay,
        stopAllTimers,
    ]);

    return { display: Math.round(Math.max(display, targetPct)), isStalled };
}
