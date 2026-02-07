import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { ConfigView } from '../views/ConfigView';

vi.mock('framer-motion', () => ({
    motion: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        div: ({ children, ...props }: any) => {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { initial, animate, exit, variants, transition, layoutId, ...validProps } = props;
            return React.createElement('div', validProps, children);
        },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
}));

describe('ConfigView', () => {
    afterEach(cleanup);
    const defaultProps = {
        pdfFile: null,
        setPdfFile: vi.fn(),
        deckName: '',
        setDeckName: vi.fn(),
        examMode: false,
        toggleExamMode: vi.fn(),
        estimation: null,
        isEstimating: false,
        handleGenerate: vi.fn(),
        setStep: vi.fn(),
        health: { anki_connected: true, gemini_configured: true },
        densityTarget: 1.5,
        setDensityTarget: vi.fn(),
        sourceType: 'auto' as 'auto' | 'slides' | 'script',
        setSourceType: vi.fn(),
    };

    it('renders necessary inputs', () => {
        render(<ConfigView {...defaultProps} />);
        expect(screen.getByText(/Source Material/i)).toBeInTheDocument();
        expect(screen.getByPlaceholderText(/University::Subject::Topic/i)).toBeInTheDocument();
        expect(screen.getByText(/Exam Mode/i)).toBeInTheDocument();
    });

    it('disables generate button when inputs are missing', () => {
        render(<ConfigView {...defaultProps} />);
        const generateBtn = screen.getByRole('button', { name: /Start Generation/i });
        expect(generateBtn).toBeDisabled();
    });

    it('enables generate button when inputs are present', () => {
        const props = {
            ...defaultProps,
            pdfFile: new File([''], 'test.pdf'),
            deckName: 'Test Deck',
        };
        render(<ConfigView {...props} />);
        const generateBtn = screen.getByRole('button', { name: /Start Generation/i });
        expect(generateBtn).not.toBeDisabled();
    });
});
