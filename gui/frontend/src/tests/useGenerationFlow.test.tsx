import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGenerationFlow } from '../hooks/useGenerationFlow';
import { api } from '../api';

// Mock the API
vi.mock('../api', () => ({
    api: {
        estimateCost: vi.fn(),
        generate: vi.fn(),
        stopGeneration: vi.fn(),
    },
}));

describe('useGenerationFlow', () => {
    const mockSetters = {
        setStep: vi.fn(),
        setLogs: vi.fn(),
        setProgress: vi.fn(),
        setSessionId: vi.fn(),
        setCards: vi.fn(),
        setCurrentPhase: vi.fn(),
        setIsError: vi.fn(),
        setIsCancelling: vi.fn(),
        setEstimation: vi.fn(),
        setIsEstimating: vi.fn(),
    };

    const mockState = {
        pdfFile: new File([''], 'test.pdf', { type: 'application/pdf' }),
        deckName: 'Test Deck',
        focusPrompt: '',
        sourceType: 'auto' as const,
        densityTarget: 1.0,
        sessionId: null,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('clears estimation when pdfFile is missing', () => {
        const stateNoPdf = { ...mockState, pdfFile: null };
        renderHook(() => useGenerationFlow(stateNoPdf, mockSetters as any));

        expect(mockSetters.setEstimation).toHaveBeenCalledWith(null);
        expect(mockSetters.setIsEstimating).toHaveBeenCalledWith(false);
    });

    it('triggers estimation when pdfFile changes', async () => {
        (api.estimateCost as any).mockResolvedValue({ total_tokens: 100 });

        renderHook(() => useGenerationFlow(mockState, mockSetters as any));

        expect(mockSetters.setIsEstimating).toHaveBeenCalledWith(true);
        // Wait for async effect
        await vi.waitFor(() => {
            expect(api.estimateCost).toHaveBeenCalled();
            expect(mockSetters.setEstimation).toHaveBeenCalled();
            expect(mockSetters.setIsEstimating).toHaveBeenCalledWith(false);
        });
    });

    it('handleGenerate sets up state and calls api.generate', async () => {
        const { result } = renderHook(() => useGenerationFlow(mockState, mockSetters as any));

        await act(async () => {
            await result.current.handleGenerate();
        });

        expect(mockSetters.setStep).toHaveBeenCalledWith('generating');
        expect(mockSetters.setLogs).toHaveBeenCalledWith([]);
        expect(api.generate).toHaveBeenCalled();
    });

    it('processes events from api.generate', async () => {
        // Mock api.generate to immediately call the callback
        (api.generate as any).mockImplementation((_req: any, onEvent: any) => {
            onEvent({ type: 'session_start', data: { session_id: '123' }, message: 'started' });
            onEvent({ type: 'step_start', message: 'Generate cards' });
            onEvent({ type: 'done', message: 'done' });
            return Promise.resolve();
        });

        const { result } = renderHook(() => useGenerationFlow(mockState, mockSetters as any));

        await act(async () => {
            await result.current.handleGenerate();
        });

        expect(mockSetters.setSessionId).toHaveBeenCalledWith('123');
        expect(mockSetters.setCurrentPhase).toHaveBeenCalledWith('generating');
        expect(mockSetters.setStep).toHaveBeenCalledWith('done');
    });

    it('processes progress and card events', async () => {
        (api.generate as any).mockImplementation((_req: any, onEvent: any) => {
            onEvent({ type: 'progress_start', data: { total: 10 } });
            onEvent({ type: 'progress_update', data: { current: 5 } });
            onEvent({ type: 'card_generated', data: { card: { front: 'f', back: 'b' } } });
            onEvent({ type: 'done', message: 'done' });
            return Promise.resolve();
        });

        const { result } = renderHook(() => useGenerationFlow(mockState, mockSetters as any));

        await act(async () => {
            await result.current.handleGenerate();
        });

        expect(mockSetters.setProgress).toHaveBeenCalledWith({ current: 0, total: 10 });
        expect(mockSetters.setProgress).toHaveBeenCalledWith(expect.any(Function));
        expect(mockSetters.setCards).toHaveBeenCalledWith(expect.any(Function));
    });

    it('maps all phases correctly', async () => {
        (api.generate as any).mockImplementation((_req: any, onEvent: any) => {
            onEvent({ type: 'step_start', message: 'Building concept map' });
            onEvent({ type: 'step_start', message: 'Generate cards' });
            onEvent({ type: 'step_start', message: 'AI Reflection' });
            return Promise.resolve();
        });

        const { result } = renderHook(() => useGenerationFlow(mockState, mockSetters as any));

        await act(async () => {
            await result.current.handleGenerate();
        });

        expect(mockSetters.setCurrentPhase).toHaveBeenCalledWith('concept');
        expect(mockSetters.setCurrentPhase).toHaveBeenCalledWith('generating');
        expect(mockSetters.setCurrentPhase).toHaveBeenCalledWith('reflecting');
    });

    it('handles error events and network errors', async () => {
        // Error event
        (api.generate as any).mockImplementation((_req: any, onEvent: any) => {
            onEvent({ type: 'error', message: 'failed' });
            return Promise.resolve();
        });

        const { result } = renderHook(() => useGenerationFlow(mockState, mockSetters as any));

        await act(async () => {
            await result.current.handleGenerate();
        });

        expect(mockSetters.setIsError).toHaveBeenCalledWith(true);

        // Network error
        (api.generate as any).mockRejectedValue(new Error('Network error'));

        await act(async () => {
            await result.current.handleGenerate();
        });

        expect(mockSetters.setIsError).toHaveBeenCalledWith(true);
        expect(mockSetters.setLogs).toHaveBeenCalledWith(expect.any(Function));
    });

    it('handleCancel calls stopGeneration', () => {
        const stateWithSession = { ...mockState, sessionId: '123' };
        const { result } = renderHook(() => useGenerationFlow(stateWithSession, mockSetters as any));

        act(() => {
            result.current.handleCancel();
        });

        expect(mockSetters.setIsCancelling).toHaveBeenCalledWith(true);
        expect(api.stopGeneration).toHaveBeenCalledWith('123');
    });

    it('logs error during estimation fails', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
        (api.estimateCost as any).mockRejectedValue(new Error('Fail'));

        renderHook(() => useGenerationFlow(mockState, mockSetters as any));

        await vi.waitFor(() => {
            expect(consoleSpy).toHaveBeenCalled();
            expect(mockSetters.setEstimation).toHaveBeenCalledWith(null);
        });
        consoleSpy.mockRestore();
    });
});
