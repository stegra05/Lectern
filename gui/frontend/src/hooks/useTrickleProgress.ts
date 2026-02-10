import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Smoothly interpolates progress between discrete jumps.
 *
 * When the real `targetPct` hasn't changed for a while, the hook
 * slowly creeps the displayed value forward using a decelerating
 * curve so it never actually reaches the next expected milestone.
 */
export function useTrickleProgress(targetPct: number): number {
    const [display, setDisplay] = useState(targetPct);
    const prevTarget = useRef(targetPct);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const stopTrickle = useCallback(() => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
    }, []);

    // When the real target jumps, snap display to it and restart trickle timer.
    useEffect(() => {
        if (targetPct !== prevTarget.current) {
            prevTarget.current = targetPct;
            stopTrickle();
            // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate: sync display with new target
            setDisplay(targetPct);
        }

        // Don't trickle at boundaries
        if (targetPct >= 100 || targetPct <= 0) return;

        const ceiling = Math.min(targetPct + 5, 99);

        const timeout = setTimeout(() => {
            intervalRef.current = setInterval(() => {
                setDisplay((prev) => {
                    if (prev >= ceiling) {
                        if (intervalRef.current) clearInterval(intervalRef.current);
                        return prev;
                    }
                    // Decelerate: advance by a fraction of remaining gap
                    const step = (ceiling - prev) * 0.06;
                    return prev + Math.max(step, 0.05);
                });
            }, 200);
        }, 1500);

        return () => {
            clearTimeout(timeout);
            stopTrickle();
        };
    }, [targetPct, stopTrickle]);

    return Math.round(Math.max(display, targetPct));
}
