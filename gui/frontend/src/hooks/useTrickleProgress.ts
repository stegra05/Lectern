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
    /** Time without update before considering stalled (ms). Default: 10000 */
    stallThreshold: number;
}

export const DEFAULT_CONFIG: TrickleConfig = {
    startDelay: 1500,
    tickInterval: 200,
    decayFactor: 0.06,
    minStep: 0.05,
    ceilingOffset: 5,
    maxDisplay: 99,
    stallThreshold: 10000,
};

/**
 * Result of the trickle progress hook.
 */
export interface TrickleProgressResult {
    /** The display percentage to show */
    display: number;
    /** Whether the progress appears stalled (no backend update for stallThreshold ms) */
    isStalled: boolean;
}

/**
 * Smoothly interpolates progress between discrete jumps with stall detection.
 *
 * When the real `targetPct` hasn't changed for a while, the hook
 * slowly creeps the displayed value forward using a decelerating
 * curve so it never actually reaches the next expected milestone.
 *
 * If the target hasn't updated for longer than stallThreshold, the hook
 * reports a stalled state for UI indication.
 *
 * @param targetPct - The actual progress percentage from the backend
 * @param config - Optional configuration overrides
 * @returns Object with display percentage and stalled state
 */
export function useTrickleProgress(
    targetPct: number,
    config: Partial<TrickleConfig> = {}
): TrickleProgressResult {
    const cfg: TrickleConfig = { ...DEFAULT_CONFIG, ...config };

    const [display, setDisplay] = useState(targetPct);
    const [isStalled, setIsStalled] = useState(false);
    const prevTarget = useRef(targetPct);
    const lastUpdateRef = useRef(Date.now());
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

    // Track when target changes to reset stall detection
    useEffect(() => {
        if (targetPct !== prevTarget.current) {
            prevTarget.current = targetPct;
            lastUpdateRef.current = Date.now();
            setIsStalled(false);
            stopAllTimers();
            // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate: sync display with new target
            setDisplay(targetPct);
        }
    }, [targetPct, stopAllTimers]);

    // Main trickle effect with consolidated stall detection
    useEffect(() => {
        // Don't trickle at boundaries
        if (targetPct >= 100 || targetPct <= 0) {
            return;
        }

        const ceiling = Math.min(targetPct + cfg.ceilingOffset, cfg.maxDisplay);

        timeoutRef.current = setTimeout(() => {
            intervalRef.current = setInterval(() => {
                const timeSinceUpdate = Date.now() - lastUpdateRef.current;
                const stalled = timeSinceUpdate > cfg.stallThreshold;

                if (stalled !== isStalled) {
                    setIsStalled(stalled);
                }

                setDisplay((prev) => {
                    if (stalled) {
                        // Continue trickling but slower when stalled
                        const stalledStep = (ceiling - prev) * cfg.decayFactor * 0.3;
                        return prev + Math.max(stalledStep, cfg.minStep * 0.3);
                    }

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
        cfg.stallThreshold,
        isStalled,
        stopAllTimers,
    ]);

    return {
        display: Math.round(Math.max(display, targetPct)),
        isStalled,
    };
}
