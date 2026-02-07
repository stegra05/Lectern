import { render, screen } from '@testing-library/react';
import { SettingsModal } from '../components/SettingsModal';
import { vi, describe, it, expect } from 'vitest';

// Mock the API
vi.mock('../api', () => ({
    api: {
        getConfig: vi.fn().mockResolvedValue({}),
        saveConfig: vi.fn(),
    },
}));

describe('SettingsModal', () => {
    const mockOnClose = vi.fn();
    const mockToggleTheme = vi.fn();

    it('renders with accessible close button', async () => {
        render(
            <SettingsModal
                isOpen={true}
                onClose={mockOnClose}
                theme="light"
                toggleTheme={mockToggleTheme}
            />
        );

        const closeButton = screen.getByLabelText('Close settings');
        expect(closeButton).toBeInTheDocument();

        // Wait for config to load to avoid act warning
        await screen.findByText('AI Model');
    });

    it('renders with accessible theme toggle', async () => {
        render(
            <SettingsModal
                isOpen={true}
                onClose={mockOnClose}
                theme="light"
                toggleTheme={mockToggleTheme}
            />
        );

        const toggleButton = screen.getByLabelText('Toggle dark mode');
        expect(toggleButton).toBeInTheDocument();

        // Wait for config to load to avoid act warning
        await screen.findByText('AI Model');
        expect(toggleButton).toHaveAttribute('role', 'switch');
        expect(toggleButton).toHaveAttribute('aria-checked', 'false');
    });

    it('reflects dark mode state in accessible attributes', async () => {
        render(
            <SettingsModal
                isOpen={true}
                onClose={mockOnClose}
                theme="dark"
                toggleTheme={mockToggleTheme}
            />
        );

        const toggleButton = screen.getByLabelText('Toggle dark mode');
        expect(toggleButton).toHaveAttribute('aria-checked', 'true');

        // Wait for config to load to avoid act warning
        await screen.findByText('AI Model');
    });
});
