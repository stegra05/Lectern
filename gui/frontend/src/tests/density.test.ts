
import { describe, it, expect } from 'vitest';
import { computeDensitySummary } from '../utils/density';

describe('computeDensitySummary', () => {
    it('does not clamp density for small PDFs', () => {
        const result = computeDensitySummary(1.0, 'slides', 10);
        if (result.mode === 'slides') {
            expect(result.targetPerSlide).toBe('1.0');
        }
    });

    it('does NOT clamp density for large PDFs (fix confirmed)', () => {
        // User sets 1.0, page count 72 (>= 50).
        // Previous logic clamped to 1.8. Now should be 1.0.
        const result = computeDensitySummary(1.0, 'slides', 72);

        if (result.mode === 'slides') {
            expect(result.targetPerSlide).toBe('1.0');
            expect(result.totalEst).toBe(Math.round(72 * 1.0));
        } else {
            throw new Error('Expected slides mode');
        }
    });

    it('does NOT clamp density for very large PDFs', () => {
        // User sets 1.0, page count 120 (>= 100).
        // Previous logic clamped to 2.0. Now should be 1.0.
        const result = computeDensitySummary(1.0, 'slides', 120);

        if (result.mode === 'slides') {
            expect(result.targetPerSlide).toBe('1.0');
        }
    });
});
