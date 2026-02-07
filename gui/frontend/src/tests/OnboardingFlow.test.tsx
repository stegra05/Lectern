import { render, screen, waitFor } from '@testing-library/react';
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
        GlassCard: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children)
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return ({ children, ...props }: any) => React.createElement(prop as string, props, children);
        }
    });
    return {
        motion,
        AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    };
});

import { api } from '../api';

describe('OnboardingFlow', () => {
    const mockOnComplete = vi.fn();

    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('shows help text when Anki connection fails', async () => {
        // Mock health check failure
        vi.mocked(api.checkHealth).mockRejectedValue(new Error('Failed'));

        render(<OnboardingFlow onComplete={mockOnComplete} />);

        // Should initially show "Anki Connection"
        expect(screen.getByText('Anki Connection')).toBeInTheDocument();

        // Wait for failure state
        await waitFor(() => {
            expect(screen.getByText(/Is Anki running with AnkiConnect/i)).toBeInTheDocument();
            expect(screen.getByText(/2055492159/)).toBeInTheDocument();
        });
    });

    it('navigates to AI Service step on Anki success', async () => {
        vi.mocked(api.checkHealth).mockResolvedValue({
            anki_connected: true,
            gemini_configured: false
        });

        render(<OnboardingFlow onComplete={mockOnComplete} />);

        await waitFor(() => {
            expect(screen.getByText('CONNECTED: LOCALHOST:8765')).toBeInTheDocument();
        }, { timeout: 3000 });

        // Check if AI Service section becomes active and shows input
        await waitFor(() => {
            expect(screen.getByPlaceholderText('sk-...')).toBeInTheDocument();
            expect(screen.getByText('Get Free Key')).toBeInTheDocument();
        }, { timeout: 3000 });
    });
});
