import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { ProgressView } from '../views/ProgressView';
import type { Phase } from '../components/PhaseIndicator';

// Mock scrollIntoView
window.HTMLElement.prototype.scrollIntoView = vi.fn();

const buildDefaultState = () => ({
    step: 'generating' as const,
    setStep: vi.fn(),
    currentPhase: 'generating' as Phase,
    logs: [],
    handleCopyLogs: vi.fn(),
    copied: false,
    isCancelling: false,
    handleCancel: vi.fn(),
    progress: { current: 5, total: 10 },
    cards: [],
    handleReset: vi.fn(),
    sessionId: null,
    sortBy: 'creation' as const,
    setSortBy: vi.fn(),
    searchQuery: '',
    setSearchQuery: vi.fn(),
    isHistorical: false,
    isError: false,

    // Edit & Sync Props
    editingIndex: null,
    editForm: null,
    isSyncing: false,
    syncSuccess: false,
    syncProgress: { current: 0, total: 0 },
    syncLogs: [],
    handleDelete: vi.fn(),
    handleAnkiDelete: vi.fn(),
    startEdit: vi.fn(),
    cancelEdit: vi.fn(),
    saveEdit: vi.fn(),
    handleFieldChange: vi.fn(),
    handleSync: vi.fn(),
    confirmModal: { isOpen: false, type: 'lectern' as const, index: -1 },
    setConfirmModal: vi.fn(),
});

let storeState: ReturnType<typeof buildDefaultState>;

const useLecternStore = vi.fn(() => storeState);

vi.mock('../store', () => ({
    useLecternStore: () => useLecternStore(),
}));

vi.mock('framer-motion', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const MockComponent = ({ children, ...props }: any) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { initial, animate, exit, variants, transition, layoutId, layout, ...validProps } = props;
        return React.createElement('div', validProps, children);
    };

    return {
        motion: {
            div: MockComponent,
            circle: MockComponent,
            path: MockComponent,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
    };
});

describe('ProgressView', () => {
    afterEach(cleanup);
    beforeEach(() => {
        storeState = buildDefaultState();
    });

    it('renders progress indicators', () => {
        render(<ProgressView />);
        expect(screen.getByText(/Generation Status/i)).toBeInTheDocument();
        expect(screen.getByText('48%')).toBeInTheDocument();
        expect(screen.getByText('PROCESSING')).toBeInTheDocument();
    });

    it('renders sorting pills', () => {
        render(<ProgressView />);
        expect(screen.getByText('creation')).toBeInTheDocument();
        expect(screen.getByText('topic')).toBeInTheDocument();
        expect(screen.getByText('slide')).toBeInTheDocument();
        expect(screen.getByText('type')).toBeInTheDocument();
    });

    it('calls setSortBy when a pill is clicked', () => {
        render(<ProgressView />);
        const topicPill = screen.getByText('topic');
        topicPill.click();
        expect(storeState.setSortBy).toHaveBeenCalledWith('topic');
    });

    it('shows cancel button when generating', () => {
        render(<ProgressView />);
        expect(screen.getByText('CANCEL')).toBeInTheDocument();
    });

    it('reorders cards when sortBy changes', () => {
        const cards = [
            { front: 'A', back: 'A', slide_number: 2, slide_topic: 'Z', model_name: 'Cloze', fields: { Front: 'A' } },
            { front: 'B', back: 'B', slide_number: 1, slide_topic: 'A', model_name: 'Basic', fields: { Front: 'B' } },
        ];

        // Test slide sorting
        storeState = { ...storeState, cards, sortBy: 'slide' };
        const { rerender } = render(<ProgressView />);
        const slideTexts = screen.getAllByText(/SLIDE \d/i).map(el => el.textContent);
        expect(slideTexts).toEqual(['SLIDE 1', 'SLIDE 2']);

        // Test topic sorting
        storeState = { ...storeState, cards, sortBy: 'topic' };
        rerender(<ProgressView />);
        let cardTypes = screen.getAllByText(/Basic|Cloze/i).filter(el => el.tagName === 'SPAN').map(el => el.textContent);
        // Topic 'A' has model 'Basic', Topic 'Z' has model 'Cloze' -> Order should be Basic, Cloze
        expect(cardTypes).toEqual(['Basic', 'Cloze']);

        // Test type sorting
        storeState = { ...storeState, cards, sortBy: 'type' };
        rerender(<ProgressView />);
        cardTypes = screen.getAllByText(/Basic|Cloze/i).filter(el => el.tagName === 'SPAN').map(el => el.textContent);
        // Basic < Cloze -> Order should be Basic, Cloze
        expect(cardTypes).toEqual(['Basic', 'Cloze']);
    });

    it('shows completion state correctly', () => {
        storeState = {
            ...storeState,
            step: 'done' as const,
            currentPhase: 'complete' as Phase,
            progress: { current: 10, total: 10 },
        };
        render(<ProgressView />);
        expect(screen.getByText(/Generation Insights/i)).toBeInTheDocument();
        expect(screen.getByText(/Start New Session/i)).toBeInTheDocument();
    });

    it('filters cards based on search query', () => {
        const cards = [
            { front: 'Apple', back: 'Fruit', model_name: 'Basic', fields: { Front: 'Apple', Back: 'Fruit' } },
            { front: 'Banana', back: 'Fruit', model_name: 'Basic', fields: { Front: 'Banana', Back: 'Fruit' } },
            { front: 'Carrot', back: 'Vegetable', model_name: 'Basic', fields: { Front: 'Carrot', Back: 'Vegetable' } },
        ];

        // Match "Apple"
        storeState = { ...storeState, cards, searchQuery: 'Apple' };
        const { rerender } = render(<ProgressView />);
        expect(screen.getByText('Apple')).toBeInTheDocument();
        expect(screen.queryByText('Banana')).not.toBeInTheDocument();
        expect(screen.queryByText('Carrot')).not.toBeInTheDocument();

        // Match "fruit" (case insensitive)
        storeState = { ...storeState, cards, searchQuery: 'fruit' };
        rerender(<ProgressView />);
        expect(screen.getByText('Apple')).toBeInTheDocument(); // Back is Fruit
        expect(screen.getByText('Banana')).toBeInTheDocument(); // Back is Fruit
        expect(screen.queryByText('Carrot')).not.toBeInTheDocument();
    });

    it('supports regex search', () => {
        const cards = [
            { front: 'Cat', back: 'Animal', fields: { Front: 'Cat', Back: 'Animal' }, model_name: 'Basic' },
            { front: 'Bat', back: 'Animal', fields: { Front: 'Bat', Back: 'Animal' }, model_name: 'Basic' },
            { front: 'Rat', back: 'Animal', fields: { Front: 'Rat', Back: 'Animal' }, model_name: 'Basic' },
        ];

        // Regex /^[CB]at/ -> Cat, Bat
        storeState = { ...storeState, cards, searchQuery: '/^[CB]at/' };
        render(<ProgressView />);
        expect(screen.getByText('Cat')).toBeInTheDocument();
        expect(screen.getByText('Bat')).toBeInTheDocument();
        expect(screen.queryByText('Rat')).not.toBeInTheDocument();
    });
    it('shows sync overlay when isSyncing is true', () => {
        storeState = {
            ...storeState,
            isSyncing: true,
            syncProgress: { current: 1, total: 2 },
            syncLogs: [{ type: 'status' as const, message: 'Uploading...', timestamp: Date.now() / 1000 }],
        };
        render(<ProgressView />);
        expect(screen.getByText(/Syncing to Anki/i)).toBeInTheDocument();
        expect(screen.getByText('50%')).toBeInTheDocument();
        expect(screen.getByText('Uploading...')).toBeInTheDocument();
    });

    it('shows success overlay when syncSuccess is true', () => {
        storeState = {
            ...storeState,
            syncSuccess: true,
        };
        render(<ProgressView />);
        expect(screen.getByText(/Sync Complete/i)).toBeInTheDocument();
    });

    it('shows error overlay when isError is true', () => {
        storeState = {
            ...storeState,
            isError: true,
            logs: [{ type: 'error' as const, message: 'Fatal error', timestamp: Date.now() / 1000 }],
        };
        render(<ProgressView />);
        expect(screen.getByText(/Process Interrupted/i)).toBeInTheDocument();
        expect(screen.getAllByText('Fatal error').length).toBeGreaterThan(0);
    });

    it('renders slide numbers and topics', () => {
        const cards = [{
            front: 'A', back: 'B', tag: 't1',
            slide_number: 42, slide_topic: 'Neural Networks', model_name: 'Basic'
        }];
        storeState = { ...storeState, cards };
        render(<ProgressView />);
        expect(screen.getByText(/SLIDE 42/i)).toBeInTheDocument();
        expect(screen.getByText('Neural Networks')).toBeInTheDocument();
    });

    it('handles card actions: edit, archive, delete', () => {
        const cards = [{
            front: 'A', back: 'B', model_name: 'Basic', anki_note_id: 101
        }];
        storeState = { ...storeState, cards, step: 'done' as const };
        render(<ProgressView />);

        // Edit
        const editBtn = screen.getByTitle('Edit');
        editBtn.click();
        expect(storeState.startEdit).toHaveBeenCalledWith(0);

        // Archive (Lectern remove)
        const archiveBtn = screen.getByTitle('Remove');
        archiveBtn.click();
        expect(storeState.setConfirmModal).toHaveBeenCalledWith(expect.objectContaining({ type: 'lectern', index: 0 }));

        // Delete (Anki)
        const deleteBtn = screen.getByTitle('Delete from Anki');
        deleteBtn.click();
        expect(storeState.setConfirmModal).toHaveBeenCalledWith(expect.objectContaining({ type: 'anki', noteId: 101 }));
    });

    it('renders Edit mode correctly', () => {
        const cards = [{ front: 'A', back: 'B', model_name: 'Basic', fields: { Front: 'A', Back: 'B' } }];
        storeState = {
            ...storeState,
            cards,
            editingIndex: 0,
            editForm: cards[0],
        };
        render(<ProgressView />);
        expect(screen.getByText(/Editing Card/i)).toBeInTheDocument();
        expect(screen.getByDisplayValue('A')).toBeInTheDocument();

        // Save
        const saveBtn = screen.getAllByRole('button').find(btn => btn.querySelector('svg.lucide-save'));
        if (saveBtn) {
            (saveBtn as HTMLElement).click();
            expect(storeState.saveEdit).toHaveBeenCalledWith(0);
        }
    });

    it('handles confirm modal callbacks', () => {
        storeState = {
            ...storeState,
            confirmModal: { isOpen: true, type: 'anki' as const, index: 0, noteId: 101 },
        };
        render(<ProgressView />);

        // We need to find the Confirm button in the modal.
        // ConfirmModal is a separate component, let's see if we need to mock it or if it's rendered.
        // It's rendered.
        const confirmBtn = screen.getByText('Permanently Delete');
        confirmBtn.click();
        expect(storeState.handleAnkiDelete).toHaveBeenCalledWith(101, 0);

        const closeBtn = screen.getByText('Cancel');
        closeBtn.click();
        expect(storeState.setConfirmModal).toHaveBeenCalled();
    });
});
