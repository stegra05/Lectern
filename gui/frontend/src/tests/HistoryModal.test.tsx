import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { HistoryModal } from '../components/HistoryModal';

describe('HistoryModal', () => {
    const mockEntries = [
        {
            id: '1',
            session_id: 'sess_1',
            filename: 'lecture1.pdf',
            full_path: '/path/1',
            deck: 'Biology',
            date: '2024-02-08',
            card_count: 50,
            status: 'completed' as const
        },
        {
            id: '2',
            session_id: 'sess_2',
            filename: 'lecture2.pdf',
            full_path: '/path/2',
            deck: 'Chemistry',
            date: '2024-02-08',
            card_count: 0,
            status: 'error' as const
        }
    ];

    const defaultProps = {
        isOpen: true,
        onClose: vi.fn(),
        history: mockEntries,
        loadSession: vi.fn(),
        deleteHistoryEntry: vi.fn(),
        clearAllHistory: vi.fn(),
        batchDeleteHistory: vi.fn(),
    };

    it('renders history entries', () => {
        render(<HistoryModal {...defaultProps} />);
        expect(screen.getByText('lecture1.pdf')).toBeInTheDocument();
        expect(screen.getByText(/Biology/i)).toBeInTheDocument();
        expect(screen.getByText(/50 cards/i)).toBeInTheDocument();
    });

    it('calls loadSession when an entry is clicked', () => {
        render(<HistoryModal {...defaultProps} />);
        const entry = screen.getByText('lecture1.pdf');
        fireEvent.click(entry);
        expect(defaultProps.loadSession).toHaveBeenCalledWith('sess_1');
    });

    it('calls deleteHistoryEntry after confirm flow', () => {
        render(<HistoryModal {...defaultProps} />);
        const deleteBtn = screen.getByTitle('Delete Session');
        fireEvent.click(deleteBtn);
        // Confirm banner should appear
        const confirmBtn = screen.getByText('Confirm');
        fireEvent.click(confirmBtn);
        expect(defaultProps.deleteHistoryEntry).toHaveBeenCalledWith('1');
    });

    it('calls clearAllHistory after confirm flow', () => {
        render(<HistoryModal {...defaultProps} />);
        const clearBtn = screen.getByText(/Clear All/i);
        fireEvent.click(clearBtn);
        const confirmBtn = screen.getByText('Confirm');
        fireEvent.click(confirmBtn);
        expect(defaultProps.clearAllHistory).toHaveBeenCalled();
    });

    it('shows empty state when no history', () => {
        render(<HistoryModal {...defaultProps} history={[]} />);
        expect(screen.getByText(/No sessions found/i)).toBeInTheDocument();
    });

    it('does not render when isOpen is false', () => {
        const { container } = render(<HistoryModal {...defaultProps} isOpen={false} />);
        expect(container.firstChild).toBeNull();
    });

    it('shows cancelled status indicator', () => {
        const entries = [{
            ...mockEntries[0],
            id: '3',
            session_id: 'sess_3',
            status: 'cancelled' as const,
        }];
        render(<HistoryModal {...defaultProps} history={entries} />);
        // Default filter is 'completed'; switch to 'all' to see the entry
        fireEvent.click(screen.getByText('All'));
        expect(screen.getByTitle('Cancelled')).toBeInTheDocument();
    });
});
