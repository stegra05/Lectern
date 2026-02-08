import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToastProvider, useToast } from '../hooks/useToast';

const TestComponent = () => {
    const { success } = useToast();
    return (
        <button onClick={() => success('Test Message')}>
            Show Toast
        </button>
    );
};

describe('Toast Component', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders toast when success is called', async () => {
        render(
            <ToastProvider>
                <TestComponent />
            </ToastProvider>
        );

        const button = screen.getByText('Show Toast');
        act(() => {
            button.click();
        });

        expect(screen.getByText('Test Message')).toBeInTheDocument();
    });

    it('removes toast after duration', async () => {
        render(
            <ToastProvider>
                <TestComponent />
            </ToastProvider>
        );

        const button = screen.getByText('Show Toast');
        act(() => {
            button.click();
        });

        expect(screen.getByText('Test Message')).toBeInTheDocument();

        act(() => {
            vi.advanceTimersByTime(5100);
        });

        expect(screen.queryByText('Test Message')).not.toBeInTheDocument();
    });
});
