/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HomeView } from '../views/HomeView';
import { useLecternStore } from '../store';

vi.mock('../store', () => ({
    useLecternStore: vi.fn()
}));

// Mock the estimation logic hook since we test it separately or trigger it via store changes
vi.mock('../hooks/useEstimationLogic', () => ({
    useEstimationLogic: vi.fn(),
}));

// Mock ResizeObserver for Framer Motion
globalThis.ResizeObserver = class {
    observe() { }
    unobserve() { }
    disconnect() { }
};

describe('HomeView', () => {
    let mockStore: any;

    beforeEach(() => {
        vi.clearAllMocks();

        // Default store state
        mockStore = {
            pdfFile: null,
            setPdfFile: vi.fn(),
            deckName: '',
            setDeckName: vi.fn(),
            focusPrompt: '',
            setFocusPrompt: vi.fn(),
            sourceType: 'auto',
            setSourceType: vi.fn(),
            targetDeckSize: 20,
            setTargetDeckSize: vi.fn(),
            estimation: null,
            isEstimating: false,
            estimationError: null,
            totalSessionSpend: 0,
            budgetLimit: null,
            wouldExceedBudget: vi.fn(() => false),
            addToSessionSpend: vi.fn(),
            availableDecks: [],
            setAvailableDecks: vi.fn(),
        };

        vi.mocked(useLecternStore).mockImplementation((selector: any) => selector(mockStore));
    });

    const defaultProps = {
        handleGenerate: vi.fn(),
        health: { anki_connected: true, gemini_configured: true, anki_version: '1.0' },
    };

    it('renders initial state correctly', () => {
        render(<HomeView {...defaultProps} />);
        expect(screen.getByText('Source Material')).toBeInTheDocument();
        expect(screen.getByText('Configuration')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Start Generation/i })).toBeDisabled();
    });

    it('enables generate button when file and deck are selected', () => {
        mockStore.pdfFile = new File([''], 'test.pdf');
        mockStore.deckName = 'Test Deck';
        mockStore.estimation = {
            pages: 10, cost: 0.01, model: 'gemini', suggested_card_count: 20
        };

        render(<HomeView {...defaultProps} />);
        expect(screen.getByRole('button', { name: /Start Generation/i })).not.toBeDisabled();
    });

    it('shows estimation results when available', () => {
        mockStore.pdfFile = new File([''], 'test.pdf');
        mockStore.deckName = 'Test Deck';
        mockStore.estimation = {
            cost: 0.03,
            input_tokens: 1000,
            output_tokens: 500,
            input_cost: 0.01,
            output_cost: 0.02,
            pages: 10,
            model: 'gemini-pro'
        };

        render(<HomeView {...defaultProps} />);
        expect(screen.getByText('$0.030')).toBeInTheDocument();

        // Expand details
        fireEvent.click(screen.getByText('Estimated Cost'));
        expect(screen.getByText('1.0k')).toBeInTheDocument();
        expect(screen.getByText('0.5k')).toBeInTheDocument();
    });

    it('shows Anki disconnection warning', async () => {
        const props = {
            ...defaultProps,
            health: { ...defaultProps.health, anki_connected: false },
        };
        render(<HomeView {...props} />);

        const warning = await screen.findByText(/Anki disconnected/i);
        expect(warning).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Start Generation/i })).toBeDisabled();
    });

    it('calls handleGenerate when button is clicked', () => {
        mockStore.pdfFile = new File([''], 'test.pdf');
        mockStore.deckName = 'Test Deck';
        mockStore.estimation = {
            pages: 10, cost: 0.01, model: 'gemini', suggested_card_count: 20
        };

        render(<HomeView {...defaultProps} />);
        const btn = screen.getByRole('button', { name: /Start Generation/i });
        fireEvent.click(btn);
        expect(defaultProps.handleGenerate).toHaveBeenCalled();
    });
});
