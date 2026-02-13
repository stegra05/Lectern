import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { CoverageGrid } from '../components/CoverageGrid';
import type { Card } from '../api';

// Mock framer-motion
vi.mock('framer-motion', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const MockComponent = ({ children, onClick, className, title, disabled }: any) => {
        return React.createElement('button', { onClick, className, title, disabled }, children);
    };

    return {
        motion: {
            div: MockComponent,
            button: MockComponent,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
    };
});

describe('CoverageGrid', () => {
    afterEach(cleanup);

    const mockCards: Card[] = [
        { front: 'A', back: 'B', slide_number: 1, _uid: '1' },
        { front: 'C', back: 'D', slide_number: 1, _uid: '2' },
        { front: 'E', back: 'F', slide_number: 3, _uid: '3' },
    ];

    it('renders correct number of pages', () => {
        render(<CoverageGrid totalPages={5} cards={mockCards} />);
        expect(screen.getByText('Page Coverage')).toBeInTheDocument();
        // Should find numbers 1 through 5
        [1, 2, 3, 4, 5].forEach(num => {
            // We look for text content matching the number exactly
            const badges = screen.getAllByText(String(num));
            // Filter out the summary "2/5" text if it matches single digit
            const badge = badges.find(el => el.tagName === 'BUTTON');
            expect(badge).toBeInTheDocument();
        });
    });

    it('calculates coverage stats correctly', () => {
        render(<CoverageGrid totalPages={5} cards={mockCards} />);
        // 1 & 3 are covered, so 2 pages covered out of 5 = 40%
        expect(screen.getByText(/2\/5 \(40%\)/)).toBeInTheDocument();
    });

    it('handles empty cards', () => {
        render(<CoverageGrid totalPages={3} cards={[]} />);
        expect(screen.getByText(/0\/3 \(0%\)/)).toBeInTheDocument();
    });

    it('does not render if totalPages is 0', () => {
        const { container } = render(<CoverageGrid totalPages={0} cards={[]} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('derives total pages from strict slide_number metadata', () => {
        const cards = [
            { front: 'A', back: 'B', slide_number: 3, _uid: '1' } as Card,
            { front: 'C', back: 'D', slide_number: 2, _uid: '2' } as Card,
        ];

        render(<CoverageGrid totalPages={0} cards={cards} />);
        expect(screen.getByText(/2\/3 \(67%\)/)).toBeInTheDocument();
        expect(screen.getByTitle('Page 3: 1 card')).toBeInTheDocument();
    });

    it('shows tooltip with correct count', () => {
        render(<CoverageGrid totalPages={3} cards={mockCards} />);
        // Page 1 has 2 cards
        expect(screen.getByTitle('Page 1: 2 cards')).toBeInTheDocument();
        // Page 3 has 1 card
        expect(screen.getByTitle('Page 3: 1 card')).toBeInTheDocument();
        // Page 2 has 0 cards
        expect(screen.getByTitle('Page 2: 0 cards')).toBeInTheDocument();
    });

    it('calls onPageClick when a page is clicked', () => {
        const onPageClick = vi.fn();
        render(<CoverageGrid totalPages={3} cards={mockCards} onPageClick={onPageClick} />);

        const page1 = screen.getByTitle(/Page 1:/i);
        fireEvent.click(page1);

        expect(onPageClick).toHaveBeenCalledWith(1);
    });

    it('highlights active page', () => {
        render(<CoverageGrid totalPages={3} cards={mockCards} activePage={1} onPageClick={() => { }} />);

        const page1 = screen.getByTitle(/Page 1:/i);
        // Since we check for class names in tests usually by regex or indirectly, 
        // checking if it has the active class `bg-primary` and `text-background`
        expect(page1.className).toContain('bg-primary');
        expect(page1.className).toContain('text-background');
    });

    it('shows Clear Filter button when activePage is set', () => {
        const onPageClick = vi.fn();
        render(<CoverageGrid totalPages={3} cards={mockCards} activePage={1} onPageClick={onPageClick} />);

        const clearBtn = screen.getByText('Clear Filter');
        expect(clearBtn).toBeInTheDocument();

        fireEvent.click(clearBtn);
        expect(onPageClick).toHaveBeenCalledWith(1); // Clicking clear calls with current page (toggle logic in parent)
    });
});
