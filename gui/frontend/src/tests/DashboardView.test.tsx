import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { DashboardView } from '../views/DashboardView';

vi.mock('framer-motion', () => ({
    motion: {
        div: ({ children, ...props }: any) => {
            const { initial, animate, exit, variants, transition, layoutId, ...validProps } = props;
            return React.createElement('div', validProps, children);
        },
    },
    AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
}));

describe('DashboardView', () => {
    afterEach(cleanup);

    it('renders without crashing', () => {
        const mockProps = {
            history: [],
            clearAllHistory: vi.fn(),
            deleteHistoryEntry: vi.fn(),
            setDeckName: vi.fn(),
            setPdfFile: vi.fn(),
            setStep: vi.fn(),
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
                date: Date.now(), // Component expects 'date'
                deck: 'Test Deck', // Component expects 'deck'
                filename: 'test.pdf', // Component expects 'filename'
                card_count: 10, // Component expects 'card_count'
                status: 'complete'
            }
        ];

        const mockProps = {
            history: mockHistory,
            clearAllHistory: vi.fn(),
            deleteHistoryEntry: vi.fn(),
            setDeckName: vi.fn(),
            setPdfFile: vi.fn(),
            setStep: vi.fn(),
        };

        render(<DashboardView {...mockProps} />);
        expect(screen.getByText('Test Deck')).toBeInTheDocument();
        expect(screen.getByText('test.pdf')).toBeInTheDocument();
    });
});
