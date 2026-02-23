import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnkiHealthPanel } from '../components/AnkiHealthPanel';
import { api } from '../api';

// Mock the API module
vi.mock('../api', () => ({
    api: {
        getAnkiStatus: vi.fn(),
    },
}));

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
    motion: {
        div: ({ children, onClick, className }: { children: React.ReactNode; onClick?: () => void; className?: string }) => (
            <div onClick={onClick} className={className} data-testid="motion-div">
                {children}
            </div>
        ),
    },
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const mockOnClose = vi.fn();
const mockOnOpenSettings = vi.fn();

const defaultProps = {
    isOpen: true,
    onClose: mockOnClose,
    onOpenSettings: mockOnOpenSettings,
};

describe('AnkiHealthPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Render conditions', () => {
        it('does not render when isOpen is false', () => {
            render(<AnkiHealthPanel {...defaultProps} isOpen={false} />);

            expect(screen.queryByText('AnkiConnect Status')).not.toBeInTheDocument();
        });

        it('renders when isOpen is true', async () => {
            vi.mocked(api.getAnkiStatus).mockResolvedValue({
                connected: true,
                version: 6,
                version_ok: true,
                error: null,
            });

            await act(async () => {
                render(<AnkiHealthPanel {...defaultProps} />);
            });

            expect(screen.getByText('AnkiConnect Status')).toBeInTheDocument();
        });
    });

    describe('Loading state', () => {
        it('shows loading state while checking status', async () => {
            // Create a promise that we can resolve manually
            let resolvePromise: (value: unknown) => void;
            const pendingPromise = new Promise((resolve) => {
                resolvePromise = resolve;
            });
            vi.mocked(api.getAnkiStatus).mockReturnValue(pendingPromise as Promise<any>);

            await act(async () => {
                render(<AnkiHealthPanel {...defaultProps} />);
            });

            // Component should be in loading state
            expect(screen.getAllByText('Checking...')[0]).toBeInTheDocument();

            // Resolve the promise
            await act(async () => {
                resolvePromise!({
                    connected: true,
                    version: 6,
                    version_ok: true,
                    error: null,
                });
            });

            await waitFor(() => {
                expect(screen.getByText('Connected')).toBeInTheDocument();
            });
        });
    });

    describe('Success state', () => {
        it('displays connected status with version', async () => {
            vi.mocked(api.getAnkiStatus).mockResolvedValue({
                connected: true,
                version: 6,
                version_ok: true,
                error: null,
            });

            await act(async () => {
                render(<AnkiHealthPanel {...defaultProps} />);
            });

            await waitFor(() => {
                expect(screen.getByText('Connected')).toBeInTheDocument();
                expect(screen.getByText('Version 6')).toBeInTheDocument();
            });
        });

        it('does not show troubleshooting guide when connected', async () => {
            vi.mocked(api.getAnkiStatus).mockResolvedValue({
                connected: true,
                version: 6,
                version_ok: true,
                error: null,
            });

            await act(async () => {
                render(<AnkiHealthPanel {...defaultProps} />);
            });

            await waitFor(() => {
                expect(screen.queryByText('Quick Fixes:')).not.toBeInTheDocument();
            });
        });
    });

    describe('Error state', () => {
        it('displays error state when connection fails', async () => {
            vi.mocked(api.getAnkiStatus).mockResolvedValue({
                connected: false,
                version: null,
                version_ok: false,
                error: 'Connection refused',
            });

            await act(async () => {
                render(<AnkiHealthPanel {...defaultProps} />);
            });

            await waitFor(() => {
                expect(screen.getByText('Not Connected')).toBeInTheDocument();
                expect(screen.getByText('Connection refused')).toBeInTheDocument();
            });
        });

        it('shows troubleshooting guide when not connected', async () => {
            vi.mocked(api.getAnkiStatus).mockResolvedValue({
                connected: false,
                version: null,
                version_ok: false,
                error: null,
            });

            await act(async () => {
                render(<AnkiHealthPanel {...defaultProps} />);
            });

            await waitFor(() => {
                expect(screen.getByText('Quick Fixes:')).toBeInTheDocument();
                expect(screen.getByText('Anki not running?')).toBeInTheDocument();
                expect(screen.getByText('AnkiConnect not installed?')).toBeInTheDocument();
            });
        });

        it('handles API rejection gracefully', async () => {
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
            vi.mocked(api.getAnkiStatus).mockRejectedValue(new Error('Network error'));

            await act(async () => {
                render(<AnkiHealthPanel {...defaultProps} />);
            });

            await waitFor(() => {
                expect(screen.getByText('Not Connected')).toBeInTheDocument();
                expect(screen.getByText('Failed to check Anki status')).toBeInTheDocument();
            });

            consoleSpy.mockRestore();
        });
    });

    describe('Version warning state', () => {
        it('shows warning when connected with outdated version', async () => {
            vi.mocked(api.getAnkiStatus).mockResolvedValue({
                connected: true,
                version: 5,
                version_ok: false,
                error: null,
            });

            await act(async () => {
                render(<AnkiHealthPanel {...defaultProps} />);
            });

            await waitFor(() => {
                expect(screen.getByText('Version Warning')).toBeInTheDocument();
                expect(screen.getByText(/Outdated Version/i)).toBeInTheDocument();
            });
        });
    });

    describe('Refresh button', () => {
        it('calls API again when refresh button is clicked', async () => {
            vi.mocked(api.getAnkiStatus).mockResolvedValue({
                connected: true,
                version: 6,
                version_ok: true,
                error: null,
            });

            await act(async () => {
                render(<AnkiHealthPanel {...defaultProps} />);
            });

            await waitFor(() => {
                expect(api.getAnkiStatus).toHaveBeenCalledTimes(1);
            });

            // Click refresh
            const refreshButton = screen.getByText('Refresh');
            await act(async () => {
                fireEvent.click(refreshButton);
            });

            await waitFor(() => {
                expect(api.getAnkiStatus).toHaveBeenCalledTimes(2);
            });
        });

        it('shows loading state during refresh', async () => {
            vi.mocked(api.getAnkiStatus).mockResolvedValue({
                connected: true,
                version: 6,
                version_ok: true,
                error: null,
            });

            await act(async () => {
                render(<AnkiHealthPanel {...defaultProps} />);
            });

            // Initial load complete
            await waitFor(() => {
                expect(screen.getByText('Refresh')).toBeInTheDocument();
            });

            // Set up slow response for refresh
            let resolveRefresh: (value: unknown) => void;
            vi.mocked(api.getAnkiStatus).mockReturnValue(
                new Promise((resolve) => {
                    resolveRefresh = resolve;
                }) as Promise<any>
            );

            const refreshButton = screen.getByText('Refresh');
            await act(async () => {
                fireEvent.click(refreshButton);
            });

            // Should show loading text
            expect(screen.getAllByText('Checking...')[0]).toBeInTheDocument();

            // Resolve
            await act(async () => {
                resolveRefresh!({
                    connected: true,
                    version: 6,
                    version_ok: true,
                    error: null,
                });
            });

            await waitFor(() => {
                expect(screen.getByText('Refresh')).toBeInTheDocument();
            });
        });
    });

    describe('Close functionality', () => {
        it('calls onClose when close button is clicked', async () => {
            vi.mocked(api.getAnkiStatus).mockResolvedValue({
                connected: true,
                version: 6,
                version_ok: true,
                error: null,
            });

            await act(async () => {
                render(<AnkiHealthPanel {...defaultProps} />);
            });

            // Find and click the close button (X icon button in header)
            const closeButtons = screen.getAllByRole('button');
            // The close button is the one with just the X icon
            const closeButton = closeButtons.find(btn =>
                btn.querySelector('svg') && btn.className.includes('hover:bg-surface')
            );

            if (closeButton) {
                await act(async () => {
                    fireEvent.click(closeButton);
                });
                expect(mockOnClose).toHaveBeenCalled();
            }
        });

        it('calls onClose when backdrop is clicked', async () => {
            vi.mocked(api.getAnkiStatus).mockResolvedValue({
                connected: true,
                version: 6,
                version_ok: true,
                error: null,
            });

            await act(async () => {
                render(<AnkiHealthPanel {...defaultProps} />);
            });

            // Click the backdrop (first motion-div)
            const backdrop = screen.getAllByTestId('motion-div')[0];
            await act(async () => {
                fireEvent.click(backdrop);
            });

            expect(mockOnClose).toHaveBeenCalled();
        });
    });

    describe('Settings integration', () => {
        it('shows settings button when onOpenSettings is provided', async () => {
            vi.mocked(api.getAnkiStatus).mockResolvedValue({
                connected: false,
                version: null,
                version_ok: false,
                error: null,
            });

            await act(async () => {
                render(<AnkiHealthPanel {...defaultProps} />);
            });

            await waitFor(() => {
                expect(screen.getByText('Open Settings')).toBeInTheDocument();
            });
        });

        it('calls onClose and onOpenSettings when settings button is clicked', async () => {
            vi.mocked(api.getAnkiStatus).mockResolvedValue({
                connected: false,
                version: null,
                version_ok: false,
                error: null,
            });

            await act(async () => {
                render(<AnkiHealthPanel {...defaultProps} />);
            });

            const settingsButton = await screen.findByText('Open Settings');
            await act(async () => {
                fireEvent.click(settingsButton);
            });

            expect(mockOnClose).toHaveBeenCalled();
            expect(mockOnOpenSettings).toHaveBeenCalled();
        });
    });

    describe('Last checked timestamp', () => {
        it('displays last checked time after successful check', async () => {
            vi.mocked(api.getAnkiStatus).mockResolvedValue({
                connected: true,
                version: 6,
                version_ok: true,
                error: null,
            });

            await act(async () => {
                render(<AnkiHealthPanel {...defaultProps} />);
            });

            await waitFor(() => {
                expect(screen.getByText(/Last checked:/)).toBeInTheDocument();
            });
        });
    });
});
