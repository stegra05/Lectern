import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithQueryClient } from './test-utils';
import { OnboardingFlow } from '../components/OnboardingFlow';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock the API
vi.mock('../api', () => ({
    api: {
        checkHealth: vi.fn(),
        saveConfig: vi.fn(),
    },
}));

// Mock GlassCard to avoid import issues
vi.mock('../components/GlassCard', async () => {
    const React = await import('react');
    return {
        GlassCard: ({ children, className }: { children: React.ReactNode, className: string }) =>
            React.createElement('div', { className }, children)
    };
});

// Mock lucide-react to avoid issues
vi.mock('lucide-react', async () => {
    const React = await import('react');
    return {
        Check: () => React.createElement('span', null, 'Check'),
        Lock: () => React.createElement('span', null, 'Lock'),
        Unlock: () => React.createElement('span', null, 'Unlock'),
        ArrowRight: () => React.createElement('span', null, 'ArrowRight'),
        Terminal: () => React.createElement('span', null, 'Terminal'),
        Server: () => React.createElement('span', null, 'Server'),
        BrainCircuit: () => React.createElement('span', null, 'BrainCircuit'),
        RefreshCw: () => React.createElement('span', null, 'RefreshCw'),
        AlertCircle: () => React.createElement('span', null, 'AlertCircle'),
        HelpCircle: () => React.createElement('span', null, 'HelpCircle'),
        ChevronDown: () => React.createElement('span', null, 'ChevronDown'),
        ChevronUp: () => React.createElement('span', null, 'ChevronUp'),
    };
});

// Mock framer-motion
vi.mock('framer-motion', async () => {
    const React = await import('react');
    const motion = new Proxy({}, {
        get: (_target, prop) => {
            return ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
                React.createElement(prop as string, props, children);
        }
    });
    return {
        motion,
        AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    };
});

import { api } from '../api';

const BASE_HEALTH = {
    status: 'ok',
    anki_connected: true,
    backend_ready: true,
    gemini_configured: false,
    provider_configured: false,
    provider_ready: false,
    active_provider: 'gemini',
    diagnostics: {
        anki: { connected: true, status: 'healthy' as const },
        api_key: { configured: false, required: true },
        provider: { name: 'gemini', configured: false, ready: false },
    },
};

describe('OnboardingFlow', () => {
    const mockOnComplete = vi.fn();

    beforeEach(() => {
        vi.resetAllMocks();
        vi.useRealTimers();
    });

    it('shows help text when Anki connection fails', async () => {
        vi.mocked(api.checkHealth).mockRejectedValue(new Error('Failed'));

        renderWithQueryClient(<OnboardingFlow onComplete={mockOnComplete} />);

        expect(screen.getByText('Anki Connection')).toBeInTheDocument();

        await waitFor(() => {
            expect(screen.getByText(/Is Anki running with AnkiConnect/i)).toBeInTheDocument();
        }, { timeout: 10000 });
    });

    it('navigates to AI Service step on Anki success', async () => {
        vi.mocked(api.checkHealth).mockResolvedValue({
            ...BASE_HEALTH,
            gemini_configured: false,
        });

        renderWithQueryClient(<OnboardingFlow onComplete={mockOnComplete} />);

        await waitFor(() => {
            expect(screen.getByText('CONNECTED: LOCALHOST:8765')).toBeInTheDocument();
        }, { timeout: 10000 });

        await waitFor(() => {
            expect(screen.getByPlaceholderText('sk-...')).toBeInTheDocument();
        }, { timeout: 10000 });
    });

    it('completes onboarding when both services are configured', async () => {
        vi.mocked(api.checkHealth).mockResolvedValue({
            ...BASE_HEALTH,
            gemini_configured: true,
            provider_configured: true,
            provider_ready: true,
            diagnostics: {
                ...BASE_HEALTH.diagnostics,
                api_key: { configured: true, required: true },
                provider: { name: 'gemini', configured: true, ready: true },
            },
        });

        renderWithQueryClient(<OnboardingFlow onComplete={mockOnComplete} />);

        await waitFor(() => {
            expect(screen.getByText('AUTHENTICATED')).toBeInTheDocument();
        }, { timeout: 10000 });

        await waitFor(() => {
            expect(mockOnComplete).toHaveBeenCalled();
        }, { timeout: 10000 });
    });

    it('submits API key successfully', async () => {
        vi.mocked(api.checkHealth).mockResolvedValue({
            ...BASE_HEALTH,
            gemini_configured: false,
        });

        renderWithQueryClient(<OnboardingFlow onComplete={mockOnComplete} />);

        const input = await screen.findByPlaceholderText('sk-...', {}, { timeout: 10000 });
        fireEvent.change(input, { target: { value: 'test-api-key-long-enough' } });

        const submitButton = screen.getByText('Initialize');
        fireEvent.click(submitButton);

        await waitFor(() => {
            expect(api.saveConfig).toHaveBeenCalledWith({ gemini_api_key: 'test-api-key-long-enough' });
        }, { timeout: 10000 });

        await waitFor(() => {
            expect(mockOnComplete).toHaveBeenCalled();
        }, { timeout: 10000 });
    });

    it('shows diagnostics-driven remediation details when Anki is unavailable', async () => {
        vi.mocked(api.checkHealth).mockResolvedValue({
            status: 'ok',
            anki_connected: false,
            gemini_configured: false,
            active_provider: 'gemini',
            provider_configured: false,
            provider_ready: false,
            backend_ready: true,
            diagnostics: {
                anki: {
                    status: 'unreachable',
                    connected: false,
                    reason: 'Connection refused by AnkiConnect at localhost:8765.',
                    hint: 'Start Anki and ensure AnkiConnect is installed/enabled (add-on code: 2055492159).',
                    remediation: {
                        summary: 'Do this next to reconnect Anki.',
                        actions: [
                            {
                                label: 'Open AnkiConnect add-on page',
                                url: 'https://ankiweb.net/shared/info/2055492159',
                                description: 'Install or enable the AnkiConnect add-on.',
                            },
                            {
                                label: 'Restart Anki',
                                description: 'Restart after enabling the add-on.',
                            },
                        ],
                    },
                },
                api_key: {
                    required: true,
                    configured: false,
                    reason: 'Gemini API key is missing.',
                    hint: 'Open Settings and provide a Gemini API key.',
                },
                provider: {
                    name: 'gemini',
                    configured: false,
                    ready: false,
                    reason: 'Gemini provider requires an API key.',
                    hint: 'Add a Gemini API key in Settings to enable generation.',
                },
            },
        });

        renderWithQueryClient(<OnboardingFlow onComplete={mockOnComplete} />);

        await waitFor(() => {
            expect(screen.getByRole('alert')).toBeInTheDocument();
        }, { timeout: 10000 });

        expect(screen.getByRole('button', { name: /Retry Anki connection/i })).toBeInTheDocument();
        expect(screen.getByText(/Continue Offline \(Save as Drafts\)/i)).toBeInTheDocument();
        expect(screen.getByText('Connection refused by AnkiConnect at localhost:8765.')).toBeInTheDocument();
        expect(screen.getByText('Start Anki and ensure AnkiConnect is installed/enabled (add-on code: 2055492159).')).toBeInTheDocument();
        expect(screen.getByText('Do this next to reconnect Anki.')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Open AnkiConnect add-on page' })).toHaveAttribute(
            'href',
            'https://ankiweb.net/shared/info/2055492159'
        );
        expect(screen.getByText('Restart Anki')).toBeInTheDocument();
    });

    it('shows API key remediation guidance when diagnostics report missing key', async () => {
        vi.mocked(api.checkHealth).mockResolvedValue({
            status: 'ok',
            anki_connected: true,
            gemini_configured: false,
            active_provider: 'gemini',
            provider_configured: false,
            provider_ready: false,
            backend_ready: true,
            diagnostics: {
                anki: {
                    status: 'healthy',
                    connected: true,
                },
                api_key: {
                    required: true,
                    configured: false,
                    reason: 'Gemini API key is missing.',
                    hint: 'Open Settings and provide a Gemini API key.',
                    remediation: {
                        summary: 'Complete these steps to enable AI generation.',
                        actions: [
                            {
                                label: 'Generate Gemini key',
                                url: 'https://aistudio.google.com/app/apikey',
                            },
                            {
                                label: 'Paste key and initialize',
                                description: 'Return here, paste your key, then click Initialize.',
                            },
                        ],
                    },
                },
                provider: {
                    name: 'gemini',
                    configured: false,
                    ready: false,
                    reason: 'Gemini provider requires an API key.',
                    hint: 'Add a Gemini API key in Settings to enable generation.',
                },
            },
        });

        renderWithQueryClient(<OnboardingFlow onComplete={mockOnComplete} />);

        await waitFor(() => {
            expect(screen.getByPlaceholderText('sk-...')).toBeInTheDocument();
        }, { timeout: 10000 });

        expect(screen.getByRole('button', { name: /Initialize with API key/i })).toBeDisabled();
        expect(screen.getByText('Gemini API key is missing.')).toBeInTheDocument();
        expect(screen.getByText('Open Settings and provide a Gemini API key.')).toBeInTheDocument();
        expect(screen.getByText('Complete these steps to enable AI generation.')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Generate Gemini key' })).toHaveAttribute(
            'href',
            'https://aistudio.google.com/app/apikey'
        );
        expect(screen.getByText('Paste key and initialize')).toBeInTheDocument();
    });

    it('transitions from retry to success when health refetch becomes healthy', async () => {
        vi.mocked(api.checkHealth)
            .mockResolvedValueOnce({
                status: 'ok',
                anki_connected: false,
                gemini_configured: false,
                active_provider: 'gemini',
                provider_configured: false,
                provider_ready: false,
                backend_ready: true,
                diagnostics: {
                    anki: {
                        status: 'offline',
                        connected: false,
                        reason: 'Anki connection check returned offline.',
                        hint: 'Start Anki and ensure AnkiConnect is installed/enabled (add-on code: 2055492159).',
                    },
                    api_key: {
                        required: true,
                        configured: false,
                        reason: 'Gemini API key is missing.',
                        hint: 'Open Settings and provide a Gemini API key.',
                    },
                    provider: {
                        name: 'gemini',
                        configured: false,
                        ready: false,
                        reason: 'Gemini provider requires an API key.',
                        hint: 'Add a Gemini API key in Settings to enable generation.',
                    },
                },
            })
            .mockResolvedValue({
                status: 'ok',
                anki_connected: true,
                gemini_configured: false,
                active_provider: 'gemini',
                provider_configured: false,
                provider_ready: false,
                backend_ready: true,
                diagnostics: {
                    anki: {
                        status: 'healthy',
                        connected: true,
                    },
                    api_key: {
                        required: true,
                        configured: false,
                        reason: 'Gemini API key is missing.',
                        hint: 'Open Settings and provide a Gemini API key.',
                    },
                    provider: {
                        name: 'gemini',
                        configured: false,
                        ready: false,
                    },
                },
            });

        renderWithQueryClient(<OnboardingFlow onComplete={mockOnComplete} />);

        const retryButton = await screen.findByRole('button', { name: /Retry Anki connection/i }, { timeout: 10000 });
        fireEvent.click(retryButton);

        await waitFor(() => {
            expect(screen.getByText('CONNECTED: LOCALHOST:8765')).toBeInTheDocument();
            expect(screen.getByText('Gemini API key is missing.')).toBeInTheDocument();
        }, { timeout: 2200 });
    });
});
