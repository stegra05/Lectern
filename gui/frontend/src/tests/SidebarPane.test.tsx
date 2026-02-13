import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { SidebarPane } from '../components/SidebarPane';
import { Layers } from 'lucide-react';

// Mock framer-motion
vi.mock('framer-motion', () => ({
    motion: {
        div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    },
    AnimatePresence: ({ children }: any) => <>{children}</>,
}));

describe('SidebarPane', () => {
    afterEach(cleanup);

    it('renders title and icon', () => {
        render(
            <SidebarPane title="Test Pane" icon={Layers}>
                <div>Content</div>
            </SidebarPane>
        );
        expect(screen.getByText('Test Pane')).toBeInTheDocument();
    });

    it('toggles content visibility', () => {
        render(
            <SidebarPane title="Test Pane" icon={Layers} defaultOpen={false}>
                <div>Secret Content</div>
            </SidebarPane>
        );

        // Initially hidden? 
        // With our mock AnimatePresence/isOpen logic, yes.
        expect(screen.queryByText('Secret Content')).not.toBeInTheDocument();

        // Click header to open
        const header = screen.getByText('Test Pane');
        fireEvent.click(header);

        // Now visible
        expect(screen.getByText('Secret Content')).toBeInTheDocument();

        // Click again to close
        fireEvent.click(header);
        expect(screen.queryByText('Secret Content')).not.toBeInTheDocument();
    });

    it('respects defaultOpen prop', () => {
        render(
            <SidebarPane title="Test Pane" icon={Layers} defaultOpen={true}>
                <div>Visible Content</div>
            </SidebarPane>
        );
        expect(screen.getByText('Visible Content')).toBeInTheDocument();
    });
});
