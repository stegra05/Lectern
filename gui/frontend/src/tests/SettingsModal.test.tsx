import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
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
    },
    getApiUrl: vi.fn().mockReturnValue('http://localhost:4173'),
}));

const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    theme: 'light' as const,
    toggleTheme: vi.fn(),
    totalSessionSpend: 0,
    budgetLimit: null,
    onResetSessionSpend: vi.fn(),
    onSetBudgetLimit: vi.fn(),
};

describe('SettingsModal', () => {
    const mockOnClose = vi.fn();
    const mockToggleTheme = vi.fn();
    const defaultConfig = {
        gemini_model: 'gemini-3-flash',
        anki_url: 'http://localhost:8765',
        basic_model: 'Basic',
        cloze_model: 'Cloze',
        tag_template: '{{deck}}::{{slide_set}}::{{topic}}',
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(api.getConfig).mockResolvedValue(defaultConfig);
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
        const user = userEvent.setup();
        render(<SettingsModal {...defaultProps} />);

        const input = await screen.findByPlaceholderText('Enter new Gemini API Key');
        await user.type(input, 'new-api-key');

        const updateButton = await screen.findByRole('button', { name: /Save Changes/i });
        await user.click(updateButton);

        await waitFor(() => {
            expect(api.saveConfig).toHaveBeenCalledWith(expect.objectContaining({ gemini_api_key: 'new-api-key' }));
        });
        // Should clear input after save
        await waitFor(() => expect(input).toHaveValue(''));
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
            current: '1.2.0',
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
