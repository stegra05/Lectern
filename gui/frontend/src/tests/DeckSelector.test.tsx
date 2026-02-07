import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeckSelector } from '../components/DeckSelector';
import { api } from '../api';

// Mock API
vi.mock('../api', () => ({
    api: {
        getDecks: vi.fn(),
        createDeck: vi.fn(),
    }
}));

// Mock localStorage
Object.defineProperty(window, 'localStorage', {
    value: {
        getItem: vi.fn(),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
    },
    writable: true
});

describe('DeckSelector', () => {
    const mockOnChange = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        // Default API response
        (api.getDecks as any).mockResolvedValue({ decks: ['Uni', 'Uni::Math', 'Uni::CS'] });
    });

    it('renders with initial value', () => {
        render(<DeckSelector value="Uni::Math" onChange={mockOnChange} />);
        expect(screen.getByRole('textbox')).toHaveValue('Uni::Math');
    });

    it('fetches decks on focus', async () => {
        render(<DeckSelector value="" onChange={mockOnChange} />);
        const input = screen.getByRole('textbox');

        fireEvent.focus(input);

        expect(api.getDecks).toHaveBeenCalled();
        const option = await screen.findByText('Uni');
        expect(option).toBeInTheDocument();
    });

    it('filters decks based on input', async () => {
        render(<DeckSelector value="" onChange={mockOnChange} />);
        const input = screen.getByRole('textbox');

        fireEvent.focus(input);
        await screen.findByText('Uni'); // Wait for initial load

        fireEvent.change(input, { target: { value: 'Mat' } });

        // Uni::Math should be visible
        const mathOption = await screen.findByText('Uni::Math');
        expect(mathOption).toBeInTheDocument();

        // Uni::CS should not be visible (queryByText returns null if not found)
        expect(screen.queryByText('Uni::CS')).not.toBeInTheDocument();
    });

    it('shows create option for new deck', async () => {
        render(<DeckSelector value="" onChange={mockOnChange} />);
        const input = screen.getByRole('textbox');

        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: 'NewDeck' } });

        // The text is split across nodes: Create new deck "<strong>NewDeck</strong>"
        // textContent matches both the span and its parent div, so we use findAllByText
        const createOptions = await screen.findAllByText((content, element) => {
            return element?.textContent === 'Create new deck "NewDeck"';
        });

        expect(createOptions.length).toBeGreaterThan(0);
        expect(createOptions[0]).toBeInTheDocument();
    });

    it('creates deck on enter', async () => {
        (api.createDeck as any).mockResolvedValue({ status: 'created' });

        render(<DeckSelector value="" onChange={mockOnChange} />);
        const input = screen.getByRole('textbox');

        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: 'NewDeck' } });
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

        await waitFor(() => {
            expect(api.createDeck).toHaveBeenCalledWith('NewDeck');
            expect(mockOnChange).toHaveBeenCalledWith('NewDeck');
        });
    });

    it('validates invalid deck names', async () => {
        render(<DeckSelector value="" onChange={mockOnChange} />);
        const input = screen.getByRole('textbox');

        fireEvent.change(input, { target: { value: 'Invalid::' } });
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

        expect(api.createDeck).not.toHaveBeenCalled();
    });
});
