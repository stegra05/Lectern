import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { DashboardView } from '../views/DashboardView';

vi.mock('framer-motion', () => ({
    motion: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        div: ({ children, ...props }: any) => {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { initial, animate, exit, variants, transition, layoutId, ...validProps } = props;
            return React.createElement('div', validProps, children);
        },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
}));

describe('DashboardView', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(cleanup);

    it('renders without crashing', () => {
        const mockProps = {
            history: [],
            clearAllHistory: vi.fn(),
            deleteHistoryEntry: vi.fn(),
            setDeckName: vi.fn(),
            setPdfFile: vi.fn(),
            setStep: vi.fn(),
            loadSession: vi.fn(),
        };

        render(<DashboardView {...mockProps} />);
        const recentSessions = screen.getAllByText(/Recent Sessions/i);
        expect(recentSessions.length).toBeGreaterThan(0);
        expect(screen.getByText(/Create New Deck/i)).toBeInTheDocument();
    });

    it('displays history items when provided', () => {
        const mockHistory = [
            {
                id: '123',
                session_id: '123',
                date: new Date().toISOString(),
                deck: 'Test Deck',
                filename: 'test.pdf',
                full_path: '/tmp/test.pdf',
                card_count: 10,
                status: 'completed' as const
            }
        ];

        const mockProps = {
            history: mockHistory,
            clearAllHistory: vi.fn(),
            deleteHistoryEntry: vi.fn(),
            setDeckName: vi.fn(),
            setPdfFile: vi.fn(),
            setStep: vi.fn(),
            loadSession: vi.fn(),
        };

        render(<DashboardView {...mockProps} />);
        expect(screen.queryByText('Test Deck')).toBeInTheDocument();
        expect(screen.queryByText('test.pdf')).toBeInTheDocument();
    });

    it('filters history by status when chips are clicked', async () => {
        const mockHistory = [
            { id: '1', session_id: '1', date: new Date().toISOString(), deck: 'Deck 1', filename: 'file1.pdf', full_path: '', card_count: 5, status: 'completed' as const },
            { id: '2', session_id: '2', date: new Date().toISOString(), deck: 'Deck 2', filename: 'file2.pdf', full_path: '', card_count: 3, status: 'draft' as const },
        ];

        const mockProps = {
            history: mockHistory,
            clearAllHistory: vi.fn(),
            deleteHistoryEntry: vi.fn(),
            setDeckName: vi.fn(),
            setPdfFile: vi.fn(),
            setStep: vi.fn(),
            loadSession: vi.fn(),
        };

        render(<DashboardView {...mockProps} />);

        // By default 'completed' is selected
        expect(screen.getByText('Deck 1')).toBeInTheDocument();
        expect(screen.queryByText('Deck 2')).not.toBeInTheDocument();

        // Click 'In Progress' chip
        const draftChip = screen.getByText('In Progress');
        fireEvent.click(draftChip);

        // Now should show Deck 2, not Deck 1
        await waitFor(() => {
            expect(screen.queryByText('Deck 1')).not.toBeInTheDocument();
            expect(screen.getByText('Deck 2')).toBeInTheDocument();
        });

        // Click 'All' chip
        const allChip = screen.getByText('All');
        fireEvent.click(allChip);

        await waitFor(() => {
            expect(screen.getByText('Deck 1')).toBeInTheDocument();
            expect(screen.getByText('Deck 2')).toBeInTheDocument();
        });
    });

    it('shows status counts correctly', () => {
        const mockHistory = [
            { id: '1', session_id: '1', date: new Date().toISOString(), deck: 'D1', filename: 'f1', full_path: '', card_count: 0, status: 'completed' as const },
            { id: '2', session_id: '2', date: new Date().toISOString(), deck: 'D2', filename: 'f2', full_path: '', card_count: 0, status: 'completed' as const },
            { id: '3', session_id: '3', date: new Date().toISOString(), deck: 'D3', filename: 'f3', full_path: '', card_count: 0, status: 'draft' as const },
        ];

        const mockProps = {
            history: mockHistory,
            clearAllHistory: vi.fn(),
            deleteHistoryEntry: vi.fn(),
            setDeckName: vi.fn(),
            setPdfFile: vi.fn(),
            setStep: vi.fn(),
            loadSession: vi.fn(),
        };

        render(<DashboardView {...mockProps} />);

        expect(screen.getByText('2')).toBeInTheDocument(); // Completed count
        expect(screen.getByText('1')).toBeInTheDocument(); // Draft count
        expect(screen.getByText('3')).toBeInTheDocument(); // All count
    });
});
