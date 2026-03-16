import { describe, it, expect } from 'vitest';
import { PROGRESS_WEIGHTS, countCardsByType, calculateProgressPercentage } from './progress';
import type { ProgressInput } from './progress';

describe('PROGRESS_WEIGHTS', () => {
    it('should have weights that sum to 1', () => {
        const sum = PROGRESS_WEIGHTS.concept + PROGRESS_WEIGHTS.generating + PROGRESS_WEIGHTS.reflecting;
        expect(sum).toBe(1);
    });

    it('should have expected weight distribution', () => {
        expect(PROGRESS_WEIGHTS.concept).toBe(0.10);
        expect(PROGRESS_WEIGHTS.generating).toBe(0.85);
        expect(PROGRESS_WEIGHTS.reflecting).toBe(0.05);
    });
});

describe('countCardsByType', () => {
    it('should return zeros for empty array', () => {
        expect(countCardsByType([])).toEqual({ basic: 0, cloze: 0 });
    });

    it('should count basic cards', () => {
        const cards = [
            { model_name: 'Basic' },
            { model_name: 'Basic' },
            { model_name: 'Another' },
        ];
        expect(countCardsByType(cards)).toEqual({ basic: 3, cloze: 0 });
    });

    it('should count cloze cards (case-insensitive)', () => {
        const cards = [
            { model_name: 'Cloze' },
            { model_name: 'ClozeDeletion' },
            { model_name: 'cloze' },
            { model_name: 'CLOZE' },
        ];
        expect(countCardsByType(cards)).toEqual({ basic: 0, cloze: 4 });
    });

    it('should handle cards without model_name', () => {
        const cards = [
            { model_name: undefined },
            { model_name: 'Basic' },
            {},
        ];
        expect(countCardsByType(cards)).toEqual({ basic: 3, cloze: 0 });
    });

    it('should count mixed cards correctly', () => {
        const cards = [
            { model_name: 'Basic' },
            { model_name: 'Cloze' },
            { model_name: 'Basic (and reversed card)' },
            { model_name: 'ClozeDeletion' },
        ];
        expect(countCardsByType(cards)).toEqual({ basic: 2, cloze: 2 });
    });
});

describe('calculateProgressPercentage', () => {
    const createInput = (overrides: Partial<ProgressInput>): ProgressInput => ({
        currentPhase: null,
        step: 'generating',
        cardsLength: 0,
        progressTotal: 100,
        progressCurrent: 0,
        conceptProgress: { current: 0, total: 0 },
        setupStepsCompleted: 0,
        ...overrides,
    });

    describe('complete state', () => {
        it('should return 100 when currentPhase is complete', () => {
            const input = createInput({ currentPhase: 'complete' });
            expect(calculateProgressPercentage(input)).toBe(100);
        });

        it('should return 100 when step is done', () => {
            const input = createInput({ step: 'done' });
            expect(calculateProgressPercentage(input)).toBe(100);
        });
    });

    describe('concept phase', () => {
        it('should calculate concept phase progress (0-10%)', () => {
            const input = createInput({
                currentPhase: 'concept',
                conceptProgress: { current: 5, total: 10 },
            });
            // 50% of concept phase = 50% * 0.10 = 5%
            expect(calculateProgressPercentage(input)).toBe(5);
        });

        it('should return at least 1% during concept phase', () => {
            const input = createInput({
                currentPhase: 'concept',
                conceptProgress: { current: 0, total: 10 },
            });
            expect(calculateProgressPercentage(input)).toBe(1);
        });

        it('should handle zero total in concept phase', () => {
            const input = createInput({
                currentPhase: 'concept',
                conceptProgress: { current: 0, total: 0 },
            });
            expect(calculateProgressPercentage(input)).toBe(1);
        });
    });

    describe('generating phase', () => {
        it('should calculate generating phase progress (10-95%)', () => {
            const input = createInput({
                currentPhase: 'generating',
                progressTotal: 100,
                progressCurrent: 50,
            });
            // 10% (concept) + 50% * 85% = 10% + 42.5% = 52.5% ≈ 53%
            expect(calculateProgressPercentage(input)).toBe(53);
        });

        it('should use cards length when higher than batch progress', () => {
            const input = createInput({
                currentPhase: 'generating',
                cardsLength: 75,
                progressTotal: 100,
                progressCurrent: 25,
            });
            // Uses max(75/100, 25/100) = 75%
            // 10% + 75% * 85% = 73.75% ≈ 74%
            expect(calculateProgressPercentage(input)).toBe(74);
        });

        it('should cap at 100% for generating progress', () => {
            const input = createInput({
                currentPhase: 'generating',
                cardsLength: 150,
                progressTotal: 100,
                progressCurrent: 0,
            });
            // min(1, 1.5) = 1, so 10% + 100% * 85% = 95%
            expect(calculateProgressPercentage(input)).toBe(95);
        });

        it('should handle zero total in generating phase', () => {
            const input = createInput({
                currentPhase: 'generating',
                progressTotal: 0,
                progressCurrent: 0,
                cardsLength: 0,
            });
            // 10% + 0% * 85% = 10%
            expect(calculateProgressPercentage(input)).toBe(10);
        });
    });

    describe('reflecting phase', () => {
        it('should calculate reflecting phase progress (95-100%)', () => {
            const input = createInput({
                currentPhase: 'reflecting',
                progressTotal: 10,
                progressCurrent: 5,
            });
            // 10% + 85% + 50% * 5% = 97.5% ≈ 98%
            expect(calculateProgressPercentage(input)).toBe(98);
        });

        it('should return 95% at start of reflecting phase', () => {
            const input = createInput({
                currentPhase: 'reflecting',
                progressTotal: 10,
                progressCurrent: 0,
            });
            // 10% + 85% + 0% * 5% = 95%
            expect(calculateProgressPercentage(input)).toBe(95);
        });

        it('should return 100% at end of reflecting phase', () => {
            const input = createInput({
                currentPhase: 'reflecting',
                progressTotal: 10,
                progressCurrent: 10,
            });
            // 10% + 85% + 100% * 5% = 100%
            expect(calculateProgressPercentage(input)).toBe(100);
        });
    });

    describe('setup phase', () => {
        it('should calculate setup progress when no phase is active', () => {
            const input = createInput({
                currentPhase: null,
                setupStepsCompleted: 5,
            });
            // 5 * 2 = 10%
            expect(calculateProgressPercentage(input)).toBe(10);
        });

        it('should return at least 1% during setup', () => {
            const input = createInput({
                currentPhase: null,
                setupStepsCompleted: 0,
            });
            expect(calculateProgressPercentage(input)).toBe(1);
        });
    });

    describe('edge cases', () => {
        it('should handle all zeros gracefully', () => {
            const input = createInput({
                currentPhase: null,
                step: 'generating',
                cardsLength: 0,
                progressTotal: 0,
                progressCurrent: 0,
                conceptProgress: { current: 0, total: 0 },
                setupStepsCompleted: 0,
            });
            expect(calculateProgressPercentage(input)).toBe(1);
        });

        it('should prioritize complete phase over step', () => {
            const input = createInput({
                currentPhase: 'complete',
                step: 'generating',
            });
            expect(calculateProgressPercentage(input)).toBe(100);
        });
    });

    describe('exporting and idle phases', () => {
        it('should return 100 for exporting phase (sync has its own progress)', () => {
            const input = createInput({
                currentPhase: 'exporting',
            });
            expect(calculateProgressPercentage(input)).toBe(100);
        });

        it('should return 0 for idle phase', () => {
            const input = createInput({
                currentPhase: 'idle',
            });
            expect(calculateProgressPercentage(input)).toBe(0);
        });
    });
});
