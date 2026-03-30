import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { CardEditor } from '../components/CardEditor';
import type { Card } from '../api';
import React from 'react';

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
    motion: {
        div: ({ children, ...props }: React.PropsWithChildren<React.HTMLAttributes<HTMLDivElement>>) => (
            <div {...props}>{children}</div>
        ),
    },
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../components/RichTextEditor', () => ({
    RichTextEditor: ({
        value,
        onChange,
        placeholder,
        disabled,
        onKeyDown,
    }: {
        value: string;
        onChange: (value: string) => void;
        placeholder?: string;
        disabled?: boolean;
        onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>;
    }) => (
        <textarea
            data-testid="rich-text-editor"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            disabled={disabled}
        />
    )
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

    const latexCard: Card = {
        model_name: 'Basic',
        fields: {
            Front: 'What is the normalized value?',
            Back: 'Use \\(x_{norm} = \\frac{x - \\min x}{\\max x - \\min x}\\)'
        },
        _uid: '789'
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

        // Front should have placeholder (check textContent to avoid matching class names)
        // Use getAllByText because in preview mode there might be multiple elements (e.g. layers)
        const frontElements = screen.getAllByText(/This is a/i);
        expect(frontElements.length).toBeGreaterThan(0);
        expect(frontElements[0].textContent).toContain('[...]');
        expect(frontElements[0].textContent).not.toContain('cloze');

        // Flip to back
        fireEvent.click(frontElements[0]);

        // Back should have answer highlighted (it's the second element in our structure)
        const backElements = screen.getAllByText(/This is a/i);
        expect(backElements[1].textContent).toContain('cloze');
        expect(backElements[1].innerHTML).toContain('cloze-answer');
    });

    it('renders latex markup in basic preview', () => {
        render(
            <CardEditor
                card={latexCard}
                onSave={vi.fn()}
                onCancel={vi.fn()}
                onChange={vi.fn()}
            />
        );

        fireEvent.click(screen.getByText(/Preview/i));
        fireEvent.click(screen.getByText('What is the normalized value?'));

        const answerElement = screen.getByText((content) => content.includes('Use'));
        expect(answerElement.innerHTML).toContain('katex');
    });

    it('renders latex inside cloze answers in preview back side', () => {
        const clozeMathCard: Card = {
            model_name: 'Cloze',
            fields: {
                Text: 'Identity: {{c1::\\(a^2 + b^2 = c^2\\)}}'
            },
            _uid: '999'
        };

        render(
            <CardEditor
                card={clozeMathCard}
                onSave={vi.fn()}
                onCancel={vi.fn()}
                onChange={vi.fn()}
            />
        );

        fireEvent.click(screen.getByText(/Preview/i));
        const frontElements = screen.getAllByText(/Identity:/i);
        fireEvent.click(frontElements[0]);

        const backElements = screen.getAllByText(/Identity:/i);
        expect(backElements[1].innerHTML).toContain('cloze-answer');
        expect(backElements[1].innerHTML).toContain('katex');
    });

    it('captures thumbs-down feedback with an optional reason', () => {
        const onFeedbackChange = vi.fn();
        const { rerender } = render(
            <CardEditor
                card={basicCard}
                onSave={vi.fn()}
                onCancel={vi.fn()}
                onChange={vi.fn()}
                onFeedbackChange={onFeedbackChange}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /Needs work/i }));
        expect(onFeedbackChange).toHaveBeenCalledWith('down', '');

        // Rerender with the updated prop to match controlled component behavior
        rerender(
            <CardEditor
                card={{ ...basicCard, feedback_vote: 'down' }}
                onSave={vi.fn()}
                onCancel={vi.fn()}
                onChange={vi.fn()}
                onFeedbackChange={onFeedbackChange}
            />
        );

        fireEvent.change(screen.getByLabelText(/Feedback reason/i), {
            target: { value: 'Answer is too vague' },
        });
        expect(onFeedbackChange).toHaveBeenLastCalledWith('down', 'Answer is too vague');
    });

    it('shows existing feedback metadata when editing a card', () => {
        const cardWithFeedback: Card = {
            ...basicCard,
            feedback_vote: 'up',
            feedback_reason: 'Clear and concise',
        };

        render(
            <CardEditor
                card={cardWithFeedback}
                onSave={vi.fn()}
                onCancel={vi.fn()}
                onChange={vi.fn()}
                onFeedbackChange={vi.fn()}
            />
        );

        expect(screen.getByRole('button', { name: /Helpful/i })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByLabelText(/Feedback reason/i)).toHaveValue('Clear and concise');
    });
});
