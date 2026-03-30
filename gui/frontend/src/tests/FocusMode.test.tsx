import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

import { FocusMode } from '../components/FocusMode';
import type { Card } from '../api';

vi.mock('../components/MathContent', () => ({
    MathContent: ({ html, className }: { html: string; className?: string }) => (
        <div className={className} data-testid="math-content">
            {html}
        </div>
    ),
}));

const makeCards = (): Card[] => [
    {
        _uid: 'card-1',
        model_name: 'Basic',
        fields: { Front: 'Card One Front', Back: 'Card One Back' },
    },
    {
        _uid: 'card-2',
        model_name: 'Basic',
        fields: { Front: 'Card Two Front', Back: 'Card Two Back' },
    },
    {
        _uid: 'card-3',
        model_name: 'Basic',
        fields: { Front: 'Card Three Front', Back: 'Card Three Back' },
    },
];

afterEach(() => {
    vi.restoreAllMocks();
});

describe('FocusMode', () => {
    it('navigates with ArrowRight and Space and stays at upper bound', () => {
        render(
            <FocusMode
                cards={makeCards()}
                onClose={vi.fn()}
                onDelete={vi.fn()}
                onEdit={vi.fn()}
                onSync={vi.fn()}
            />
        );

        expect(screen.getByText('Card One Front')).toBeInTheDocument();

        fireEvent.keyDown(window, { key: 'ArrowRight' });
        expect(screen.getByText('Card Two Front')).toBeInTheDocument();

        fireEvent.keyDown(window, { key: ' ' });
        expect(screen.getByText('Card Three Front')).toBeInTheDocument();

        fireEvent.keyDown(window, { key: 'ArrowRight' });
        expect(screen.getByText('Card Three Front')).toBeInTheDocument();
    });

    it('uses current index for edit/delete and supports escape to close', () => {
        const onClose = vi.fn();
        const onDelete = vi.fn();
        const onEdit = vi.fn();

        render(
            <FocusMode
                cards={makeCards()}
                onClose={onClose}
                onDelete={onDelete}
                onEdit={onEdit}
                onSync={vi.fn()}
            />
        );

        fireEvent.keyDown(window, { key: 'ArrowRight' });
        expect(screen.getByText('Card Two Front')).toBeInTheDocument();

        fireEvent.keyDown(window, { key: 'e' });
        expect(onEdit).toHaveBeenCalledWith(1);

        fireEvent.keyDown(window, { key: 'Backspace' });
        expect(onDelete).toHaveBeenCalledWith(1);

        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not rebind keydown listener on index-only navigation', () => {
        const addSpy = vi.spyOn(window, 'addEventListener');
        const removeSpy = vi.spyOn(window, 'removeEventListener');

        const { unmount } = render(
            <FocusMode
                cards={makeCards()}
                onClose={vi.fn()}
                onDelete={vi.fn()}
                onEdit={vi.fn()}
                onSync={vi.fn()}
            />
        );

        const keydownAddCount = () =>
            addSpy.mock.calls.filter(([eventName]) => eventName === 'keydown').length;
        const keydownRemoveCount = () =>
            removeSpy.mock.calls.filter(([eventName]) => eventName === 'keydown').length;

        expect(keydownAddCount()).toBe(1);
        expect(keydownRemoveCount()).toBe(0);

        fireEvent.keyDown(window, { key: 'ArrowRight' });

        expect(keydownAddCount()).toBe(1);
        expect(keydownRemoveCount()).toBe(0);

        unmount();
        expect(keydownRemoveCount()).toBe(1);
    });
});
