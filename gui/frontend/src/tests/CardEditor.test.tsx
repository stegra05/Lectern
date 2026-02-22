import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { CardEditor } from '../components/CardEditor';
import type { Card } from '../api';

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
    motion: {
        div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    },
    AnimatePresence: ({ children }: any) => <>{children}</>,
}));

describe('CardEditor', () => {
    afterEach(cleanup);

    const basicCard: Card = {
        model_name: 'Basic',
        fields: {
            Front: 'Question text',
            Back: 'Answer text'
        },
        _uid: '123'
    };

    const clozeCard: Card = {
        model_name: 'Cloze',
        fields: {
            Text: 'This is a {{c1::cloze}} sentence.'
        },
        _uid: '456'
    };

    it('renders edit mode by default', () => {
        render(
            <CardEditor
                card={basicCard}
                onSave={vi.fn()}
                onCancel={vi.fn()}
                onChange={vi.fn()}
            />
        );
        expect(screen.getByText(/Editing Card/i)).toBeInTheDocument();
        expect(screen.getByDisplayValue('Question text')).toBeInTheDocument();
    });

    it('toggles to preview mode and renders basic card', () => {
        render(
            <CardEditor
                card={basicCard}
                onSave={vi.fn()}
                onCancel={vi.fn()}
                onChange={vi.fn()}
            />
        );

        fireEvent.click(screen.getByText(/Preview/i));
        expect(screen.getByText('Question text')).toBeInTheDocument();
        expect(screen.getByText(/Click to reveal answer/i)).toBeInTheDocument();

        // Flip to back
        fireEvent.click(screen.getByText('Question text'));
        expect(screen.getByText('Answer text')).toBeInTheDocument();
    });

    it('renders cloze card preview correctly', () => {
        render(
            <CardEditor
                card={clozeCard}
                onSave={vi.fn()}
                onCancel={vi.fn()}
                onChange={vi.fn()}
            />
        );

        fireEvent.click(screen.getByText(/Preview/i));

        // Front should have placeholder
        const frontElements = screen.getAllByText(/This is a/i);
        expect(frontElements[0].innerHTML).toContain('[...]');
        expect(frontElements[0].innerHTML).not.toContain('cloze');

        // Flip to back
        fireEvent.click(frontElements[0]);

        // Back should have answer highlighted (it's the second element in our structure)
        const backElements = screen.getAllByText(/This is a/i);
        expect(backElements[1].innerHTML).toContain('cloze');
        expect(backElements[1].innerHTML).toContain('cloze-answer');
    });
});
