import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { renderWithQueryClient } from './test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SettingsModal } from '../components/SettingsModal';
import { api } from '../api';

// Proven mocking pattern
vi.mock('../api', () => ({
    api: {
        getConfig: vi.fn(),
        saveConfig: vi.fn(),
        getVersion: vi.fn(),
        getDecks: vi.fn(),
        checkHealth: vi.fn(),
        checkAnkiConnectUrl: vi.fn().mockResolvedValue({ connected: true }),
    },
    getApiUrl: vi.fn().mockReturnValue('http://localhost:4173'),
}));

const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    totalSessionSpend: 0,
    onResetSessionSpend: vi.fn(),
};

describe('SettingsModal', () => {
    const mockOnClose = vi.fn();
    const defaultConfig = {
        gemini_model: 'gemini-3-flash-preview',
        anki_url: 'http://localhost:8765',
        basic_model: 'Basic',
        cloze_model: 'Cloze',
        tag_template: '{{deck}}::{{slide_set}}::{{topic}}',
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(api.getConfig).mockResolvedValue(defaultConfig);
        vi.mocked(api.saveConfig).mockResolvedValue({ success: true });
        vi.mocked(api.getVersion).mockResolvedValue({
            current: '1.2.0',
            latest: '1.2.0',
            update_available: false,
            release_url: '',
        });
        vi.mocked(api.getDecks).mockResolvedValue({ decks: ['Default'] });
    });

    it('renders and loads configuration', async () => {
        await act(async () => {
            renderWithQueryClient(
                <SettingsModal
                    {...defaultProps}
                    isOpen={true}
                    onClose={mockOnClose}
                />
            );
        });

        expect(screen.getByText('Settings')).toBeInTheDocument();
        await waitFor(() => {
            expect(api.getConfig).toHaveBeenCalled();
            expect(screen.getByDisplayValue('Gemini 3 Flash (Fast)')).toBeInTheDocument();
        });
    });

    it('handles configuration load failure', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
        vi.mocked(api.getConfig).mockRejectedValueOnce(new Error('Failed'));

        await act(async () => {
            renderWithQueryClient(
                <SettingsModal
                    {...defaultProps}
                    isOpen={true}
                    onClose={mockOnClose}
                />
            );
        });

        await waitFor(() => {
            expect(screen.getByText(/Failed to connect/i)).toBeInTheDocument();
        });

        const retryButton = screen.getByText('Retry');
        vi.mocked(api.getConfig).mockResolvedValue(defaultConfig);

        await act(async () => {
            fireEvent.click(retryButton);
        });

        await waitFor(() => {
            expect(screen.getByDisplayValue('Gemini 3 Flash (Fast)')).toBeInTheDocument();
        });
        consoleSpy.mockRestore();
    });

    it('updates Gemini API key', async () => {
        renderWithQueryClient(<SettingsModal {...defaultProps} />);

        const input = await screen.findByPlaceholderText('Enter new Gemini API Key');

        await act(async () => {
            fireEvent.change(input, { target: { value: 'new-api-key' } });
        });

        const updateButton = await screen.findByRole('button', { name: /Save Changes/i });
        await act(async () => {
            fireEvent.click(updateButton);
        });

        await waitFor(() => {
            expect(api.saveConfig).toHaveBeenCalledWith(expect.objectContaining({ gemini_api_key: 'new-api-key' }));
        });
        // Should clear input after save
        await waitFor(() => expect(input).toHaveValue(''));
    });

    it('saves changed settings', async () => {
        await act(async () => {
            renderWithQueryClient(
                <SettingsModal
                    {...defaultProps}
                    isOpen={true}
                    onClose={mockOnClose}
                />
            );
        });

        await waitFor(() => screen.getByDisplayValue('Gemini 3 Flash (Fast)'));
        const select = screen.getByDisplayValue('Gemini 3 Flash (Fast)');

        fireEvent.change(select, { target: { value: 'gemini-3.1-pro-preview' } });

        const saveButton = screen.getByText('Save Changes');
        await act(async () => {
            fireEvent.click(saveButton);
        });

        await waitFor(
            () => {
                expect(api.saveConfig).toHaveBeenCalledWith(
                    expect.objectContaining({ gemini_model: 'gemini-3.1-pro-preview' })
                );
            },
            { timeout: 3000 }
        );
    });

    it('toggles advanced settings', async () => {
        await act(async () => {
            renderWithQueryClient(
                <SettingsModal
                    {...defaultProps}
                    isOpen={true}
                    onClose={mockOnClose}
                />
            );
        });

        await waitFor(() => screen.getByText('Show Advanced'));
        const toggle = screen.getByText('Show Advanced');

        // Anki URL is always visible now
        expect(screen.getByDisplayValue('http://localhost:8765')).toBeInTheDocument();
        // Tag Template is still advanced
        expect(screen.queryByDisplayValue('{{deck}}::{{slide_set}}::{{topic}}')).not.toBeInTheDocument();

        await act(async () => {
            fireEvent.click(toggle);
        });

        await waitFor(() => {
            expect(screen.getByDisplayValue('{{deck}}::{{slide_set}}::{{topic}}')).toBeInTheDocument();
        });
    });

    it('checks for updates', async () => {
        vi.mocked(api.getVersion).mockResolvedValue({
            current: '1.2.0',
            latest: '1.1.12',
            update_available: true,
            release_url: 'https://github.com/test/release',
        });

        await act(async () => {
            renderWithQueryClient(
                <SettingsModal
                    {...defaultProps}
                    isOpen={true}
                    onClose={mockOnClose}
                />
            );
        });

        await waitFor(() => {
            expect(screen.getByText('Update available!')).toBeInTheDocument();
            expect(screen.getByText('Download')).toBeInTheDocument();
        });
    });
});
