
import { describe, it, expect } from 'vitest';
import { computeDensitySummary } from '../utils/density';

describe('computeDensitySummary', () => {
    it('does not clamp density for small PDFs', () => {
        const result = computeDensitySummary(1.0, 'slides', 10);
        if (result.mode === 'slides') {
            expect(result.targetPerSlide).toBe('1.0');
        }
    });

    it('currently clamps density for large PDFs (reproduction)', () => {
        // This test documents the Bug behavior.
        // User sets 1.0, page count 72 (>= 50).
        // Current logic clamps to 1.8.
        const result = computeDensitySummary(1.0, 'slides', 72);

        // Asserting the BUG exists:
        if (result.mode === 'slides') {
            expect(result.targetPerSlide).toBe('1.8');
            expect(result.totalEst).toBe(Math.round(72 * 1.8));
        } else {
            throw new Error('Expected slides mode');
        }
    });

    it('currently clamps density even harder for very large PDFs', () => {
        // User sets 1.0, page count 120 (>= 100).
        // Current logic clamps to 2.0.
        const result = computeDensitySummary(1.0, 'slides', 120);

        if (result.mode === 'slides') {
            expect(result.targetPerSlide).toBe('2.0');
        }
    });
});
