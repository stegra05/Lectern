import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTrickleProgress, DEFAULT_CONFIG, type TrickleConfig } from './useTrickleProgress';

describe('useTrickleProgress', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    describe('initial state', () => {
        it('returns display equal to target initially', () => {
            const { result } = renderHook(() => useTrickleProgress(50));
            expect(result.current.display).toBe(50);
            expect(result.current.isStalled).toBe(false);
        });

        it('returns 100 when target is 100', () => {
            const { result } = renderHook(() => useTrickleProgress(100));
            expect(result.current.display).toBe(100);
        });

        it('returns 0 when target is 0', () => {
            const { result } = renderHook(() => useTrickleProgress(0));
            expect(result.current.display).toBe(0);
        });
    });

    describe('target changes', () => {
        it('snaps to new target when target changes', () => {
            const { result, rerender } = renderHook(
                ({ target }: { target: number }) => useTrickleProgress(target),
                { initialProps: { target: 50 } }
            );

            expect(result.current.display).toBe(50);

            // Change target
            rerender({ target: 75 });
            expect(result.current.display).toBe(75);

            // Change again
            rerender({ target: 25 });
            expect(result.current.display).toBe(25);
        });

        it('resets isStalled when target changes', () => {
            const { result, rerender } = renderHook(
                ({ target }: { target: number }) => useTrickleProgress(target),
                { initialProps: { target: 50 } }
            );

            expect(result.current.isStalled).toBe(false);

            // Change target
            rerender({ target: 60 });
            expect(result.current.isStalled).toBe(false);
        });
    });

    describe('configuration', () => {
        it('uses custom config values for display', () => {
            const customConfig: Partial<TrickleConfig> = {
                maxDisplay: 95,
            };

            const { result } = renderHook(() =>
                useTrickleProgress(50, customConfig)
            );

            expect(result.current.display).toBe(50);
        });

        it('merges custom config with defaults', () => {
            const customConfig: Partial<TrickleConfig> = {
                stallThreshold: 5000,
            };

            const { result } = renderHook(() =>
                useTrickleProgress(50, customConfig)
            );

            expect(result.current.display).toBe(50);
            expect(result.current.isStalled).toBe(false);
        });
    });

    describe('stall detection', () => {
        it('isStalled starts as false', () => {
            const { result } = renderHook(() => useTrickleProgress(50));
            expect(result.current.isStalled).toBe(false);
        });

        it('does not report stalled at 100%', () => {
            const { result } = renderHook(() => useTrickleProgress(100));
            vi.advanceTimersByTime(DEFAULT_CONFIG.startDelay + DEFAULT_CONFIG.tickInterval * 5);
            expect(result.current.isStalled).toBe(false);
        });

        it('does not report stalled at 0%', () => {
            const { result } = renderHook(() => useTrickleProgress(0));
            vi.advanceTimersByTime(DEFAULT_CONFIG.startDelay + DEFAULT_CONFIG.tickInterval * 5);
            expect(result.current.isStalled).toBe(false);
        });
    });

    describe('cleanup', () => {
        it('cleans up intervals on unmount', () => {
            const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

            const { unmount } = renderHook(() => useTrickleProgress(50));

            // Start the intervals
            vi.advanceTimersByTime(DEFAULT_CONFIG.startDelay + DEFAULT_CONFIG.tickInterval * 2);

            unmount();

            expect(clearIntervalSpy).toHaveBeenCalled();
        });
    });

    describe('return type', () => {
        it('returns an object with display and isStalled', () => {
            const { result } = renderHook(() => useTrickleProgress(50));

            expect(result.current).toHaveProperty('display');
            expect(result.current).toHaveProperty('isStalled');
            expect(typeof result.current.display).toBe('number');
            expect(typeof result.current.isStalled).toBe('boolean');
        });
    });
});
