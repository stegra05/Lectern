import { useState, useEffect } from 'react';

/**
 * Returns a debounced value that updates after `delay` ms of no changes.
 * Used to throttle rapid updates (e.g. slider drag) before triggering expensive effects.
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}
