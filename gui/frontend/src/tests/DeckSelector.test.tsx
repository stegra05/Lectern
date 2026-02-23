import React, { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { DeckSelector } from '../components/DeckSelector';
import { api } from '../api';
import { useLecternStore } from '../store';

// Mock API
vi.mock('../api', () => ({
    api: {
        getDecks: vi.fn(),
        createDeck: vi.fn(),
    }
}));

// Mock Store
vi.mock('../store', () => ({
    useLecternStore: vi.fn()
}));

describe('DeckSelector', () => {
    const mockOnChange = vi.fn();
    const mockSetAvailableDecks = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        // Default API response
        (api.getDecks as Mock).mockResolvedValue({ decks: ['Uni', 'Uni::Math', 'Uni::CS'] });

        // Default Store response
        vi.mocked(useLecternStore).mockImplementation((selector: any) => {
            return selector({
                availableDecks: [], // Changed to empty array
                setAvailableDecks: mockSetAvailableDecks,
            });
        });
    });

    // New ControlledDeckSelector component
    const ControlledDeckSelector = ({ initialValue = "" }: { initialValue?: string }) => {
        const [val, setVal] = useState(initialValue);
        return <DeckSelector value={val} onChange={(v) => { setVal(v); mockOnChange(v); }} />;
    };

    it('renders with initial value', () => {
        render(<ControlledDeckSelector initialValue="Uni::Math" />);
        expect(screen.getByRole('textbox')).toHaveValue('Uni::Math');
    });

    it('fetches decks on focus', async () => {
        render(<ControlledDeckSelector />);
        const input = screen.getByRole('textbox');

        fireEvent.focus(input);

        expect(api.getDecks).toHaveBeenCalled();
        const option = await screen.findByText('Uni');
        expect(option).toBeInTheDocument();
    });

    it('filters decks based on input', async () => {
        // Redefine store mock for this test to have populated decks
        vi.mocked(useLecternStore).mockImplementation((selector: any) => {
            return selector({ availableDecks: ['Uni', 'Uni::Math', 'Uni::CS'], setAvailableDecks: mockSetAvailableDecks });
        });

        render(<ControlledDeckSelector />);
        const input = screen.getByRole('textbox');

        fireEvent.focus(input);
        await screen.findByPlaceholderText('Search decks...');

        const searchInput = screen.getByPlaceholderText('Search decks...');
        fireEvent.change(searchInput, { target: { value: 'Mat' } });

        // Uni::Math should be visible
        // We look for 'Math' which is the leaf node name.
        // Since 'Mat' is highlighted, it might be split into <span>Mat</span>h
        // We use a custom matcher to find the element containing the full text
        const mathOptions = await screen.findAllByText((_, element) => {
            return element?.textContent === 'Math';
        });
        expect(mathOptions.length).toBeGreaterThan(0);

        // Uni::CS should not be visible
        expect(screen.queryByText((_, element) => element?.textContent === 'CS')).not.toBeInTheDocument();
    });

    it('shows create option for new deck', async () => {
        render(<ControlledDeckSelector />);
        const input = screen.getByRole('textbox');

        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: 'NewDeck' } });

        // The text is split across nodes: Create new deck "<strong>NewDeck</strong>"
        // textContent matches both the span and its parent div, so we use findAllByText
        const createOptions = await screen.findAllByText((_, element) => {
            return element?.textContent === 'Create new deck "NewDeck"';
        });

        expect(createOptions.length).toBeGreaterThan(0);
        expect(createOptions[0]).toBeInTheDocument();
    });

    it('creates deck on enter', async () => {
        (api.createDeck as Mock).mockResolvedValue({ status: 'created' });

        render(<ControlledDeckSelector />);
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
        render(<ControlledDeckSelector />);
        const input = screen.getByRole('textbox');

        fireEvent.change(input, { target: { value: 'Invalid::' } });
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

        expect(api.createDeck).not.toHaveBeenCalled();
    });
});
