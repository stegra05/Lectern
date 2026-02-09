import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useDebounce } from './useDebounce';

describe('useDebounce', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns initial value immediately', () => {
        const { result } = renderHook(() => useDebounce('initial', 400));
        expect(result.current).toBe('initial');
    });

    it('does not update until delay has elapsed', () => {
        const { result, rerender } = renderHook(
            ({ value, delay }) => useDebounce(value, delay),
            { initialProps: { value: 'first', delay: 400 } }
        );
        expect(result.current).toBe('first');

        rerender({ value: 'second', delay: 400 });
        expect(result.current).toBe('first');

        act(() => {
            vi.advanceTimersByTime(399);
        });
        expect(result.current).toBe('first');

        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(result.current).toBe('second');
    });

    it('debounces rapid updates to last value', () => {
        const { result, rerender } = renderHook(
            ({ value }) => useDebounce(value, 400),
            { initialProps: { value: 1 } }
        );

        rerender({ value: 2 });
        rerender({ value: 3 });
        rerender({ value: 4 });
        expect(result.current).toBe(1);

        act(() => {
            vi.advanceTimersByTime(400);
        });
        expect(result.current).toBe(4);
    });

    it('resets timer on each change during delay', () => {
        const { result, rerender } = renderHook(
            ({ value }) => useDebounce(value, 400),
            { initialProps: { value: 'a' } }
        );

        rerender({ value: 'b' });
        act(() => vi.advanceTimersByTime(200));
        rerender({ value: 'c' });
        act(() => vi.advanceTimersByTime(200));
        expect(result.current).toBe('a');

        act(() => vi.advanceTimersByTime(200));
        expect(result.current).toBe('c');
    });
});
