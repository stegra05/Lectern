import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useLecternStore } from './store';
import { act } from '@testing-library/react';

describe('Store Persistence', () => {
    beforeEach(() => {
        // Reset store
        act(() => {
            useLecternStore.getState().reset();
        });
        // Mock localStorage
        vi.stubGlobal('localStorage', {
            getItem: vi.fn(),
            setItem: vi.fn(),
            removeItem: vi.fn(),
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

        expect(localStorage.setItem).toHaveBeenCalledWith('lectern_pref_cards_per_slide', '2.00');
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

        expect(localStorage.setItem).toHaveBeenCalledWith('lectern_pref_cards_per_1k', '3.00');
    });

    it('should apply persisted preference for slides mode', () => {
        // Mock stored preference
        vi.mocked(localStorage.getItem).mockReturnValue('2.50'); // 2.5 cards per slide

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
            // Need to mock getItem implementation for the mode check in store
            vi.mocked(localStorage.getItem).mockImplementation((key) => {
                if (key === 'lectern_pref_cards_per_slide') return '2.50';
                return null;
            });
            useLecternStore.getState().setEstimation(estimation);
            useLecternStore.getState().recommendTargetDeckSize(estimation);
        });

        // 2.5 * 20 = 50 cards
        expect(useLecternStore.getState().targetDeckSize).toBe(50);
    });

    it('should apply persisted preference for script mode', () => {
        // Mock stored preference
        // 4.0 cards per 1k chars
        vi.mocked(localStorage.getItem).mockImplementation((key) => {
            if (key === 'lectern_pref_cards_per_1k') return '4.00';
            return null;
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
