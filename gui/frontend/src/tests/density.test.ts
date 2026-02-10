
import { describe, it, expect } from 'vitest';
import { computeCardsPerUnit, computeTargetSliderConfig } from '../utils/density';

describe('computeTargetSliderConfig', () => {
    it('disables slider without suggested count', () => {
        expect(computeTargetSliderConfig(undefined)).toEqual({
            min: 1,
            max: 1,
            disabled: true,
        });
    });

    it('builds range around suggested count', () => {
        expect(computeTargetSliderConfig(50)).toEqual({
            min: 25,
            max: 75,
            disabled: false,
        });
    });
});

describe('computeCardsPerUnit', () => {
    it('computes cards per slide in slides mode', () => {
        const result = computeCardsPerUnit(30, 'slides', {
            pages: 10,
            text_chars: 6000,
            input_tokens: 0,
            output_tokens: 0,
            input_cost: 0,
            output_cost: 0,
            cost: 0,
            tokens: 0,
            model: 'gemini-3-flash',
        });
        expect(result.label).toBe('Cards per slide');
        expect(result.value).toBe('3.0');
    });

    it('computes cards per 1k chars in script mode', () => {
        const result = computeCardsPerUnit(60, 'script', {
            pages: 5,
            text_chars: 10000,
            input_tokens: 0,
            output_tokens: 0,
            input_cost: 0,
            output_cost: 0,
            cost: 0,
            tokens: 0,
            model: 'gemini-3-flash',
        });
        expect(result.label).toBe('Cards per 1k chars');
        expect(result.value).toBe('6.0');
    });
});
