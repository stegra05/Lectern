import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { HomeView } from '../views/HomeView';

// Mock components to simplify HomeView testing
vi.mock('../components/FilePicker', () => ({
    FilePicker: ({ onFileSelect }: any) => (
        <div data-testid="file-picker">
            <button onClick={() => onFileSelect(new File([''], 'test.pdf', { type: 'application/pdf' }))}>
                Select File
            </button>
        </div>
    )
}));

vi.mock('../components/DeckSelector', () => ({
    DeckSelector: ({ value, onChange, disabled }: any) => (
        <div data-testid="deck-selector">
            <input
                data-testid="deck-input"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                disabled={disabled}
            />
        </div>
    )
}));

describe('HomeView', () => {
    const defaultProps = {
        pdfFile: null,
        setPdfFile: vi.fn(),
        deckName: '',
        setDeckName: vi.fn(),
        focusPrompt: '',
        setFocusPrompt: vi.fn(),
        sourceType: 'auto' as const,
        setSourceType: vi.fn(),
        densityTarget: 1.2,
        setDensityTarget: vi.fn(),
        estimation: null,
        isEstimating: false,
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
        const props = {
            ...defaultProps,
            pdfFile: new File([''], 'test.pdf'),
            deckName: 'Default',
        };
        render(<HomeView {...props} />);
        expect(screen.getByRole('button', { name: /Start Generation/i })).not.toBeDisabled();
    });

    it('handles source type selection', () => {
        render(<HomeView {...defaultProps} pdfFile={new File([''], 'test.pdf')} />);

        const slidesBtn = screen.getByText('Slides');
        fireEvent.click(slidesBtn);
        expect(defaultProps.setSourceType).toHaveBeenCalledWith('slides');
    });

    it('updates density target via slider', () => {
        render(<HomeView {...defaultProps} />);
        const slider = screen.getByRole('slider');
        fireEvent.change(slider, { target: { value: '3.5' } });
        expect(defaultProps.setDensityTarget).toHaveBeenCalledWith(3.5);
    });

    it('updates density target via number input', () => {
        render(<HomeView {...defaultProps} />);
        const numberInput = screen.getByRole('spinbutton');
        fireEvent.change(numberInput, { target: { value: '2.5' } });
        expect(defaultProps.setDensityTarget).toHaveBeenCalledWith(2.5);
    });

    it('shows estimation results when available', () => {
        const estimation = {
            pages: 10,
            input_tokens: 1000,
            output_tokens: 500,
            input_cost: 0.01,
            output_cost: 0.02,
            cost: 0.03,
            tokens: 1500,
            model: 'gemini-3-flash',
            estimated_card_count: 45,
        };
        render(<HomeView {...defaultProps} estimation={estimation} />);
        expect(screen.getByText('$0.030')).toBeInTheDocument();
        expect(screen.getByText('1.0k')).toBeInTheDocument();
        expect(screen.getByText('0.5k')).toBeInTheDocument();
        expect(screen.getByText('~45 cards')).toBeInTheDocument();
    });

    it('shows estimating state', () => {
        render(<HomeView {...defaultProps} isEstimating={true} />);
        expect(screen.getByText('Analyzing content density...')).toBeInTheDocument();
    });

    it('shows Anki disconnection warning', () => {
        const props = {
            ...defaultProps,
            health: { anki_connected: false, gemini_configured: true, anki_version: '' }
        };
        render(<HomeView {...props} />);
        expect(screen.getByText(/Anki is not connected/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Start Generation/i })).toBeDisabled();
    });

    it('displays correct density description for script mode', () => {
        render(<HomeView {...defaultProps} sourceType="script" densityTarget={1.5} />);
        expect(screen.getByText(/Extraction Granularity: 1.0x/i)).toBeInTheDocument();
    });

    it('shows EST. TOTAL CARDS badge in script mode when estimation has estimated_card_count', () => {
        const estimation = {
            pages: 72,
            cost: 0.017,
            model: 'gemini-3-flash',
            input_tokens: 0,
            output_tokens: 0,
            input_cost: 0,
            output_cost: 0,
            tokens: 0,
            estimated_card_count: 62,
        };
        render(<HomeView {...defaultProps} sourceType="script" estimation={estimation} />);
        expect(screen.getByText(/EST. 62 TOTAL CARDS/i)).toBeInTheDocument();
    });

    it('does not show EST. TOTAL CARDS badge in script mode when estimation lacks estimated_card_count', () => {
        const estimation = {
            pages: 72,
            cost: 0.017,
            model: 'gemini-3-flash',
            input_tokens: 0,
            output_tokens: 0,
            input_cost: 0,
            output_cost: 0,
            tokens: 0,
        };
        render(<HomeView {...defaultProps} sourceType="script" estimation={estimation} />);
        expect(screen.queryByText(/EST. \d+ TOTAL CARDS/i)).not.toBeInTheDocument();
    });

    it('displays correct density description for slides mode', () => {
        const estimation = {
            pages: 10,
            cost: 0,
            model: '',
            input_tokens: 0,
            output_tokens: 0,
            input_cost: 0,
            output_cost: 0,
            tokens: 0,
            estimated_card_count: 18,
        };
        render(<HomeView {...defaultProps} estimation={estimation} densityTarget={2.0} />);
        expect(screen.getByText(/Target: ~2.0 cards per active slide/i)).toBeInTheDocument();
        expect(screen.getByText(/EST. 18 TOTAL CARDS/i)).toBeInTheDocument();
    });

    it('calls handleGenerate when button is clicked', () => {
        const props = {
            ...defaultProps,
            pdfFile: new File([''], 'test.pdf'),
            deckName: 'Default',
        };
        render(<HomeView {...props} />);
        fireEvent.click(screen.getByRole('button', { name: /Start Generation/i }));
        expect(defaultProps.handleGenerate).toHaveBeenCalled();
    });

    it('updates focus prompt', () => {
        render(<HomeView {...defaultProps} />);
        const textarea = screen.getByPlaceholderText(/E.g. 'Focus on clinical formulas'/i);
        fireEvent.change(textarea, { target: { value: 'New focus' } });
        expect(defaultProps.setFocusPrompt).toHaveBeenCalledWith('New focus');
    });
});
