import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { ProgressView } from '../views/ProgressView';
import type { Phase } from '../components/PhaseIndicator';

// Mock scrollIntoView
window.HTMLElement.prototype.scrollIntoView = vi.fn();

vi.mock('framer-motion', () => ({
    motion: {
        div: ({ children, ...props }: any) => {
            const { initial, animate, exit, variants, transition, layoutId, ...validProps } = props;
            return React.createElement('div', validProps, children);
        },
    },
    AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
}));

describe('ProgressView', () => {
    afterEach(cleanup);
    const defaultProps = {
        step: 'generating' as const,
        setStep: vi.fn(),
        currentPhase: 'generating' as Phase,
        logs: [],
        handleCopyLogs: vi.fn(),
        copied: false,
        isCancelling: false,
        handleCancel: vi.fn(),
        progress: { current: 5, total: 10 },
        cards: [],
        handleReset: vi.fn(),
        setPreviewSlide: vi.fn(),
        logsEndRef: { current: document.createElement('div') },
    };

    it('renders progress indicators', () => {
        render(<ProgressView {...defaultProps} />);
        expect(screen.getByText(/Generation Status/i)).toBeInTheDocument();
        expect(screen.getByText('50%')).toBeInTheDocument();
        expect(screen.getByText('PROCESSING')).toBeInTheDocument();
    });

    it('shows cancel button when generating', () => {
        render(<ProgressView {...defaultProps} />);
        expect(screen.getByText('CANCEL')).toBeInTheDocument();
    });

    it('shows completion state correctly', () => {
        const props = {
            ...defaultProps,
            step: 'done' as const,
            currentPhase: 'complete' as Phase,
            progress: { current: 10, total: 10 },
        };
        render(<ProgressView {...props} />);
        expect(screen.getByText(/Generation Complete/i)).toBeInTheDocument();
        expect(screen.getByText(/Start New Session/i)).toBeInTheDocument();
    });
});
