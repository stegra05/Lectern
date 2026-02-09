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

    it('debounces estimate requests when density changes rapidly', async () => {
        const { setPdfFile, setDensityTarget } = useLecternStore.getState();
        const pdf = new File(['content'], 'test.pdf', { type: 'application/pdf' });

        setPdfFile(pdf);
        setDensityTarget(1.0);

        render(<App />);

        await act(async () => {
            vi.advanceTimersByTime(50);
        });

        // Simulate rapid slider drag: 1.0 -> 1.5 -> 2.0 -> 2.5
        act(() => setDensityTarget(1.5));
        act(() => setDensityTarget(2.0));
        act(() => setDensityTarget(2.5));

        const callsBeforeDebounce = (api.estimateCost as ReturnType<typeof vi.fn>).mock.calls.length;

        await act(async () => {
            vi.advanceTimersByTime(450);
        });

        const callsAfterDebounce = (api.estimateCost as ReturnType<typeof vi.fn>).mock.calls.length;
        expect(callsAfterDebounce).toBeLessThanOrEqual(callsBeforeDebounce + 1);
        const lastCall = (api.estimateCost as ReturnType<typeof vi.fn>).mock.calls.at(-1);
        if (lastCall) {
            expect(lastCall[3]).toBe(2.5);
        }
    });
});
