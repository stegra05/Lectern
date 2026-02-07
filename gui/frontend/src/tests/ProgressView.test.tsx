import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { ProgressView } from '../views/ProgressView';
import type { Phase } from '../components/PhaseIndicator';

// Mock scrollIntoView
window.HTMLElement.prototype.scrollIntoView = vi.fn();

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
        sortBy: 'creation' as const,
        setSortBy: vi.fn(),
    };

    it('renders progress indicators', () => {
        render(<ProgressView {...defaultProps} />);
        expect(screen.getByText(/Generation Status/i)).toBeInTheDocument();
        expect(screen.getByText('50%')).toBeInTheDocument();
        expect(screen.getByText('PROCESSING')).toBeInTheDocument();
    });

    it('renders sorting pills', () => {
        render(<ProgressView {...defaultProps} />);
        expect(screen.getByText('creation')).toBeInTheDocument();
        expect(screen.getByText('topic')).toBeInTheDocument();
        expect(screen.getByText('slide')).toBeInTheDocument();
        expect(screen.getByText('type')).toBeInTheDocument();
    });

    it('calls setSortBy when a pill is clicked', () => {
        render(<ProgressView {...defaultProps} />);
        const topicPill = screen.getByText('topic');
        topicPill.click();
        expect(defaultProps.setSortBy).toHaveBeenCalledWith('topic');
    });

    it('shows cancel button when generating', () => {
        render(<ProgressView {...defaultProps} />);
        expect(screen.getByText('CANCEL')).toBeInTheDocument();
    });

    it('reorders cards when sortBy changes', () => {
        const cards = [
            { front: 'A', back: 'A', slide_number: 2, slide_topic: 'Z', model_name: 'Cloze', fields: { Front: 'A' } },
            { front: 'B', back: 'B', slide_number: 1, slide_topic: 'A', model_name: 'Basic', fields: { Front: 'B' } },
        ];

        // Test slide sorting
        const { rerender } = render(<ProgressView {...defaultProps} cards={cards} sortBy="slide" />);
        let slideTexts = screen.getAllByText(/SLIDE \d/i).map(el => el.textContent);
        expect(slideTexts).toEqual(['SLIDE 1', 'SLIDE 2']);

        // Test topic sorting
        rerender(<ProgressView {...defaultProps} cards={cards} sortBy="topic" />);
        let cardTypes = screen.getAllByText(/Basic|Cloze/i).filter(el => el.tagName === 'DIV').map(el => el.textContent);
        // Topic 'A' has model 'Basic', Topic 'Z' has model 'Cloze' -> Order should be Basic, Cloze
        expect(cardTypes).toEqual(['Basic', 'Cloze']);

        // Test type sorting
        rerender(<ProgressView {...defaultProps} cards={cards} sortBy="type" />);
        cardTypes = screen.getAllByText(/Basic|Cloze/i).filter(el => el.tagName === 'DIV').map(el => el.textContent);
        // Basic < Cloze -> Order should be Basic, Cloze
        expect(cardTypes).toEqual(['Basic', 'Cloze']);
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
