import { describe, it, expect, beforeEach } from 'vitest';
import { useLecternStore } from './store';
import { act } from '@testing-library/react';

describe('Store Persistence', () => {
    beforeEach(() => {
        // Reset store
        act(() => {
            useLecternStore.getState().reset();
        });

        // Reset preferences specifically since it's part of initial state
        act(() => {
            useLecternStore.setState({ densityPreferences: { per1k: null, perSlide: null } });
        });
    });
    it('should persist card per slide preference in slides mode', () => {
        // Setup slides mode estimation (10 pages, 500 chars/page)
        const estimation = {
            pages: 10,
            text_chars: 5000,
            tokens: 100,
            input_tokens: 100,
            output_tokens: 100,
            input_cost: 0,
            output_cost: 0,
            cost: 0,
            model: 'gemini',
        };

        act(() => {
            useLecternStore.getState().setEstimation(estimation);
            // User sets target to 20 cards (2.0 per slide)
            useLecternStore.getState().setTargetDeckSize(20);
        });

        expect(useLecternStore.getState().densityPreferences.perSlide).toBeCloseTo(2.0, 2);
    });

    it('should persist card per 1k chars preference in script mode', () => {
        // Setup script mode estimation (10 pages, 3000 chars/page)
        const estimation = {
            pages: 10,
            text_chars: 30000,
            tokens: 100,
            input_tokens: 100,
            output_tokens: 100,
            input_cost: 0,
            output_cost: 0,
            cost: 0,
            model: 'gemini',
        };

        act(() => {
            useLecternStore.getState().setEstimation(estimation);
            // User sets target to 90 cards (3.0 per 1k chars)
            useLecternStore.getState().setTargetDeckSize(90);
        });

        expect(useLecternStore.getState().densityPreferences.per1k).toBeCloseTo(3.0, 2);
    });

    it('should apply persisted preference for slides mode', () => {
        act(() => {
            useLecternStore.setState({ densityPreferences: { per1k: null, perSlide: 2.5 } });
        });

        const estimation = {
            pages: 20,
            text_chars: 10000, // 500 chars/page (< 1500, so slides mode)
            tokens: 100,
            input_tokens: 100,
            output_tokens: 100,
            input_cost: 0,
            output_cost: 0,
            cost: 0,
            model: 'gemini',
            suggested_card_count: 5,
        };

        act(() => {
            useLecternStore.getState().setEstimation(estimation);
            useLecternStore.getState().recommendTargetDeckSize(estimation);
        });

        // 2.5 * 20 = 50 cards
        expect(useLecternStore.getState().targetDeckSize).toBe(50);
    });

    it('should apply persisted preference for script mode', () => {
        act(() => {
            useLecternStore.setState({ densityPreferences: { per1k: 4.0, perSlide: null } });
        });

        const estimation = {
            pages: 10,
            text_chars: 20000, // 2000 chars/page (> 1500, so script mode)
            tokens: 100,
            input_tokens: 100,
            output_tokens: 100,
            input_cost: 0,
            output_cost: 0,
            cost: 0,
            model: 'gemini',
            suggested_card_count: 5,
        };

        act(() => {
            useLecternStore.getState().setEstimation(estimation);
            useLecternStore.getState().recommendTargetDeckSize(estimation);
        });

        // 4.0 * (20000 / 1000) = 80 cards
        expect(useLecternStore.getState().targetDeckSize).toBe(80);
    });
});
