import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { HomeView } from '../views/HomeView';

// Mock components to simplify HomeView testing
vi.mock('../components/FilePicker', () => ({
    FilePicker: ({ onFileSelect }: { onFileSelect: (file: File) => void }) => (
        <div data-testid="file-picker">
            <button onClick={() => onFileSelect(new File([''], 'test_slides.pdf', { type: 'application/pdf' }))}>
                Select File
            </button>
        </div>
    )
}));

vi.mock('../components/DeckSelector', () => ({
    DeckSelector: ({ value, onChange, disabled }: { value: string; onChange: (val: string) => void; disabled?: boolean }) => (
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
        targetDeckSize: 20,
        setTargetDeckSize: vi.fn(),
        estimation: null,
        isEstimating: false,
        handleGenerate: vi.fn(),
        health: { anki_connected: true, gemini_configured: true, anki_version: '1.0' },
        estimationError: null,
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
            pdfFile: new File([''], 'test_slides.pdf'),
            deckName: 'Default',
            estimation: {
                pages: 10,
                text_chars: 5000,
                input_tokens: 1000,
                output_tokens: 500,
                input_cost: 0.01,
                output_cost: 0.02,
                cost: 0.03,
                tokens: 1500,
                model: 'gemini-3-flash',
                estimated_card_count: 25,
                suggested_card_count: 20,
            },
        };
        render(<HomeView {...props} />);
        expect(screen.getByRole('button', { name: /Start Generation/i })).not.toBeDisabled();
    });

    it('handles source type selection', () => {
        render(<HomeView {...defaultProps} pdfFile={new File([''], 'test_slides.pdf')} />);

        const slidesBtn = screen.getByText('Slides');
        fireEvent.click(slidesBtn);
        expect(defaultProps.setSourceType).toHaveBeenCalledWith('slides');
    });

    it('updates total cards via slider', () => {
        const props = {
            ...defaultProps,
            estimation: {
                pages: 10,
                text_chars: 8000,
                input_tokens: 1000,
                output_tokens: 500,
                input_cost: 0.01,
                output_cost: 0.02,
                cost: 0.03,
                tokens: 1500,
                model: 'gemini-3-flash',
                estimated_card_count: 25,
                suggested_card_count: 20,
            },
        };
        render(<HomeView {...props} />);
        const slider = screen.getByRole('slider');
        fireEvent.change(slider, { target: { value: '30' } });
        expect(defaultProps.setTargetDeckSize).toHaveBeenCalledWith(30);
    });

    it('disables total cards slider before estimate is ready', () => {
        render(<HomeView {...defaultProps} />);
        const slider = screen.getByRole('slider');
        expect(slider).not.toBeDisabled();
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
            suggested_card_count: 50,
        };
        render(<HomeView {...defaultProps} estimation={estimation} />);
        expect(screen.getByText('$0.030')).toBeInTheDocument();
        expect(screen.getByText('1.0k')).toBeInTheDocument();
        expect(screen.getByText('0.5k')).toBeInTheDocument();
        expect(screen.getByText(/Estimated Cost/i)).toBeInTheDocument();
        expect(screen.queryByText('~45 cards')).not.toBeInTheDocument();
    });

    it('shows estimating state', () => {
        render(<HomeView {...defaultProps} isEstimating={true} />);
        expect(screen.getByText('Analyzing content...')).toBeInTheDocument();
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

    it('displays cards per 1k chars for script mode', () => {
        const estimation = {
            pages: 10,
            text_chars: 10000,
            cost: 0.017,
            model: 'gemini-3-flash',
            input_tokens: 0,
            output_tokens: 0,
            input_cost: 0,
            output_cost: 0,
            tokens: 0,
            suggested_card_count: 60,
        };
        render(<HomeView {...defaultProps} sourceType="script" estimation={estimation} targetDeckSize={60} />);
        expect(screen.getByText(/Cards per 1k chars: 6.0/i)).toBeInTheDocument();
    });

    it('shows SUGGESTED badge when estimation has suggested_card_count', () => {
        const estimation = {
            pages: 72,
            text_chars: 12000,
            cost: 0.017,
            model: 'gemini-3-flash',
            input_tokens: 0,
            output_tokens: 0,
            input_cost: 0,
            output_cost: 0,
            tokens: 0,
            suggested_card_count: 62,
        };
        render(<HomeView {...defaultProps} sourceType="script" estimation={estimation} />);
        expect(screen.getByText(/SUGGESTED 62/i)).toBeInTheDocument();
    });

    it('does not show SUGGESTED badge when estimation lacks suggested_card_count', () => {
        const estimation = {
            pages: 72,
            text_chars: 12000,
            cost: 0.017,
            model: 'gemini-3-flash',
            input_tokens: 0,
            output_tokens: 0,
            input_cost: 0,
            output_cost: 0,
            tokens: 0,
        };
        render(<HomeView {...defaultProps} sourceType="script" estimation={estimation} />);
        expect(screen.queryByText(/SUGGESTED \d+/i)).not.toBeInTheDocument();
    });

    it('displays cards-per-slide summary for slides mode', () => {
        const estimation = {
            pages: 10,
            text_chars: 5000,
            cost: 0,
            model: '',
            input_tokens: 0,
            output_tokens: 0,
            input_cost: 0,
            output_cost: 0,
            tokens: 0,
            estimated_card_count: 18,
            suggested_card_count: 20,
        };
        render(<HomeView {...defaultProps} estimation={estimation} sourceType="slides" targetDeckSize={20} />);
        expect(screen.getByText(/Cards per slide: 2.0/i)).toBeInTheDocument();
        expect(screen.getByText(/SUGGESTED 20/i)).toBeInTheDocument();
    });

    it('calls handleGenerate when button is clicked', () => {
        const props = {
            ...defaultProps,
            pdfFile: new File([''], 'test_slides.pdf'),
            deckName: 'Default',
            estimation: {
                pages: 10,
                text_chars: 5000,
                input_tokens: 1000,
                output_tokens: 500,
                input_cost: 0.01,
                output_cost: 0.02,
                cost: 0.03,
                tokens: 1500,
                model: 'gemini-3-flash',
                estimated_card_count: 25,
                suggested_card_count: 20,
            },
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
