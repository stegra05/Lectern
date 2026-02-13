import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { CoverageGrid } from '../components/CoverageGrid';
import type { Card } from '../api';

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
            const badge = badges.find(el => el.className.includes('aspect-square'));
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
        const { container } = render(<CoverageGrid totalPages={0} cards={mockCards} />);
        expect(container).toBeEmptyDOMElement();
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
});
