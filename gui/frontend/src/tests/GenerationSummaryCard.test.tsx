import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { GenerationSummaryCard } from '../components/GenerationSummaryCard';
import type { ComponentProps } from 'react';

describe('GenerationSummaryCard rubric summary', () => {
    it('renders rubric summary block when provided', () => {
        const props: ComponentProps<typeof GenerationSummaryCard> = {
            summary: {
                fileName: 'sample.pdf',
                deckName: 'Deck A',
                cardCount: 20,
                sourceType: 'slides',
            },
            cost: null,
            estimation: {
                phase: 'idle',
                cost: null,
                isEstimating: false,
            },
            validation: {
                isButtonDisabled: false,
                disabledReason: '',
                showCostWarning: false,
                attemptedSubmit: false,
            },
            health: { ankiConnected: true },
            deckSelectorProps: {
                value: 'Deck A',
                availableDecks: ['Deck A'],
                isLoading: false,
                isOpen: false,
                searchQuery: '',
                expandedNodes: new Set<string>(),
                onChange: vi.fn(),
                onCreate: vi.fn(async () => true),
                onOpenChange: vi.fn(),
                onSearchChange: vi.fn(),
                onToggleNode: vi.fn(),
                onSearchMatchesChange: vi.fn(),
            },
            onGenerate: vi.fn(),
            onDismissCostWarning: vi.fn(),
            onConfirmCostWarning: vi.fn(),
            onAttemptedSubmit: vi.fn(),
            rubricSummary: {
                avg_quality: 55.2,
                min_quality: 30,
                max_quality: 88,
                below_threshold_count: 3,
                total_cards: 12,
                threshold: 60,
            },
        } as const;

        render(<GenerationSummaryCard {...props} />);

        expect(screen.getByText(/Rubric Quality/i)).toBeInTheDocument();
        expect(screen.getByText(/55.2/)).toBeInTheDocument();
    });
});
