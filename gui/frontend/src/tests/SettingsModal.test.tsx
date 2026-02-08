import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { SettingsModal } from '../components/SettingsModal';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { api } from '../api';

// Proven mocking pattern
vi.mock('../api', () => ({
    api: {
        getConfig: vi.fn(),
        saveConfig: vi.fn(),
        getVersion: vi.fn(),
        getDecks: vi.fn(),
        checkHealth: vi.fn(),
    },
    getApiUrl: vi.fn().mockReturnValue('http://localhost:4173'),
}));

describe('SettingsModal', () => {
    const mockOnClose = vi.fn();
    const mockToggleTheme = vi.fn();
    const defaultConfig = {
        gemini_model: 'gemini-3-flash',
        anki_url: 'http://localhost:8765',
        basic_model: 'Basic',
        cloze_model: 'Cloze',
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(api.getConfig).mockResolvedValue(defaultConfig);
        vi.mocked(api.getVersion).mockResolvedValue({
            current: '1.1.11',
            latest: '1.1.11',
            update_available: false,
            release_url: '',
        });
        vi.mocked(api.getDecks).mockResolvedValue({ decks: ['Default'] });
    });

    it('renders and loads configuration', async () => {
        await act(async () => {
            render(
                <SettingsModal
                    isOpen={true}
                    onClose={mockOnClose}
                    theme="light"
                    toggleTheme={mockToggleTheme}
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
            render(
                <SettingsModal
                    isOpen={true}
                    onClose={mockOnClose}
                    theme="light"
                    toggleTheme={mockToggleTheme}
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
        await act(async () => {
            render(
                <SettingsModal
                    isOpen={true}
                    onClose={mockOnClose}
                    theme="light"
                    toggleTheme={mockToggleTheme}
                />
            );
        });

        const input = await screen.findByPlaceholderText('Enter new Gemini API Key');
        const updateButton = screen.getByText('Update');

        fireEvent.change(input, { target: { value: 'new-api-key' } });
        await act(async () => {
            fireEvent.click(updateButton);
        });

        await waitFor(() => {
            expect(api.saveConfig).toHaveBeenCalledWith({ gemini_api_key: 'new-api-key' });
        });
    });

    it('saves changed settings', async () => {
        await act(async () => {
            render(
                <SettingsModal
                    isOpen={true}
                    onClose={mockOnClose}
                    theme="light"
                    toggleTheme={mockToggleTheme}
                />
            );
        });

        await waitFor(() => screen.getByDisplayValue('Gemini 3 Flash (Fast)'));
        const select = screen.getByDisplayValue('Gemini 3 Flash (Fast)');

        fireEvent.change(select, { target: { value: 'gemini-3-pro' } });

        const saveButton = screen.getByText('Save Changes');
        await act(async () => {
            fireEvent.click(saveButton);
        });

        await waitFor(() => {
            expect(api.saveConfig).toHaveBeenCalledWith(expect.objectContaining({
                gemini_model: 'gemini-3-pro'
            }));
            expect(screen.getByText(/Settings saved/i)).toBeInTheDocument();
        });
    });

    it('toggles advanced settings', async () => {
        await act(async () => {
            render(
                <SettingsModal
                    isOpen={true}
                    onClose={mockOnClose}
                    theme="light"
                    toggleTheme={mockToggleTheme}
                />
            );
        });

        await waitFor(() => screen.getByText('Show Advanced'));
        const toggle = screen.getByText('Show Advanced');

        expect(screen.queryByDisplayValue('http://localhost:8765')).not.toBeInTheDocument();

        await act(async () => {
            fireEvent.click(toggle);
        });

        await waitFor(() => {
            expect(screen.getByDisplayValue('http://localhost:8765')).toBeInTheDocument();
        });
    });

    it('checks for updates', async () => {
        vi.mocked(api.getVersion).mockResolvedValue({
            current: '1.1.11',
            latest: '1.1.12',
            update_available: true,
            release_url: 'https://github.com/test/release',
        });

        await act(async () => {
            render(
                <SettingsModal
                    isOpen={true}
                    onClose={mockOnClose}
                    theme="light"
                    toggleTheme={mockToggleTheme}
                />
            );
        });

        await waitFor(() => {
            expect(screen.getByText('Update available!')).toBeInTheDocument();
            expect(screen.getByText('Download')).toBeInTheDocument();
        });
    });

    it('toggles dark mode', async () => {
        await act(async () => {
            render(
                <SettingsModal
                    isOpen={true}
                    onClose={mockOnClose}
                    theme="light"
                    toggleTheme={mockToggleTheme}
                />
            );
        });

        const toggle = screen.getByLabelText('Toggle dark mode');
        await act(async () => {
            fireEvent.click(toggle);
        });
        expect(mockToggleTheme).toHaveBeenCalled();
    });
});
