import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import App from './App';
import { useLecternStore } from './store';
import { api } from './api';

vi.mock('./hooks/useAppState', () => ({
    useAppState: () => ({
        health: { anki_connected: true, gemini_configured: true, gemini_model: 'gemini-3-flash' },
        showOnboarding: false,
        isCheckingHealth: false,
        isSettingsOpen: false,
        setIsSettingsOpen: vi.fn(),
        isHistoryOpen: false,
        setIsHistoryOpen: vi.fn(),
        theme: 'dark',
        toggleTheme: vi.fn(),
        isRefreshingStatus: false,
        refreshHealth: vi.fn(),
    }),
}));

describe('App', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(api, 'estimateCost').mockResolvedValue({
            tokens: 1000,
            input_tokens: 1300,
            output_tokens: 455,
            input_cost: 0.01,
            output_cost: 0.02,
            cost: 0.03,
            pages: 10,
            model: 'gemini-3-flash',
            estimated_card_count: 25,
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('does not trigger API on slider change (client-side recompute)', async () => {
        const { setPdfFile, setTargetDeckSize } = useLecternStore.getState();
        const pdf = new File(['content'], 'test_slides.pdf', { type: 'application/pdf' });

        setPdfFile(pdf);
        setTargetDeckSize(20);

        render(<App />);

        // Wait for initial estimate
        await act(async () => {
            vi.advanceTimersByTime(50);
        });

        const callsBefore = (api.estimateCost as ReturnType<typeof vi.fn>).mock.calls.length;

        // Simulate rapid slider drag
        act(() => setTargetDeckSize(30));
        act(() => setTargetDeckSize(40));
        act(() => setTargetDeckSize(50));

        await act(async () => {
            vi.advanceTimersByTime(450);
        });

        const callsAfter = (api.estimateCost as ReturnType<typeof vi.fn>).mock.calls.length;

        // Should not trigger new API calls, as recomputation is client-side
        expect(callsAfter).toBe(callsBefore);
    });
});
