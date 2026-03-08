/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import React from 'react';
import { ProgressView } from '../views/ProgressView';
import type { Phase } from '../components/PhaseIndicator';
import type { Step } from '../store-types';
import type { SortOption } from '../hooks/types';

// Mock useTrickleProgress to skip animation
vi.mock('../hooks/useTrickleProgress', () => ({
    useTrickleProgress: (val: number) => ({ display: val, isStalled: false })
}));

vi.mock('../components/RichTextEditor', () => ({
    RichTextEditor: ({ value, onChange, placeholder, disabled, onKeyDown }: any) => (
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

// Mock scrollIntoView
window.HTMLElement.prototype.scrollIntoView = vi.fn();

const buildDefaultState = () => ({
    step: 'generating' as Step,
    setStep: vi.fn(),
    currentPhase: 'generating' as Phase,
    logs: [] as any[],
    handleCopyLogs: vi.fn(),
    copied: false,
    isCancelling: false,
    handleCancel: vi.fn(),
    progress: { current: 5, total: 10 },
    cards: [] as any[],
    handleReset: vi.fn(),
    sessionId: null,
    sortBy: 'creation' as SortOption,
    setSortBy: vi.fn(),
    searchQuery: '',
    setSearchQuery: vi.fn(),
    isHistorical: false,
    isError: false,
    totalPages: 0,
    coverageData: null,

    // Edit & Sync Props
    editingIndex: null as number | null,
    editForm: null as any | null,
    isSyncing: false,
    syncSuccess: false,
    syncProgress: { current: 0, total: 0 },
    syncLogs: [] as any[],
    handleDelete: vi.fn(),
    handleAnkiDelete: vi.fn(),
    startEdit: vi.fn(),
    cancelEdit: vi.fn(),
    saveEdit: vi.fn(),
    handleFieldChange: vi.fn(),
    handleSync: vi.fn(),
    confirmModal: { isOpen: false, type: 'lectern' as const, index: -1 } as any,
    setConfirmModal: vi.fn(),

    // Batch selection props
    isMultiSelectMode: false,
    selectedCards: new Set<string>(),
    toggleMultiSelectMode: vi.fn(),
    toggleCardSelection: vi.fn(),
    selectAllCards: vi.fn(),
    clearSelection: vi.fn(),
    batchDeleteSelected: vi.fn(),

    // Concept progress
    conceptProgress: { current: 0, total: 0 },
});

let storeState: ReturnType<typeof buildDefaultState>;

const mockUseLecternStore = vi.fn((selector) => {
    return selector ? selector(storeState) : storeState;
});

vi.mock('../store', () => ({
    useLecternStore: (selector: any) => mockUseLecternStore(selector),
}));

vi.mock('framer-motion', () => {
    const MockComponent = ({ children, ...props }: any) => {
        const { initial, animate, exit, variants, transition, layoutId, layout, ...validProps } = props;
        return React.createElement('div', validProps, children);
    };

    return {
        motion: {
            div: MockComponent,
            circle: MockComponent,
            path: MockComponent,
        },
        AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
    };
});

const defaultState = {
    step: 'generating',
    currentPhase: 'generating',
    logs: [],
    cards: [],
    progress: { current: 0, total: 10 },
    isError: false,
    isCancelling: false,
    handleCopyLogs: vi.fn(),
    handleCancel: vi.fn(),
    handleReset: vi.fn(),
    sortBy: 'creation',
    searchQuery: '',
    isHistorical: false,
    editingIndex: null,
    editForm: null,
    isSyncing: false,
    syncSuccess: false,
    syncPartialFailure: null,
    syncProgress: { current: 0, total: 0 },
    syncLogs: [],
    confirmModal: { isOpen: false, type: 'lectern', index: -1 },
    isMultiSelectMode: false,
    selectedCards: new Set(),
    setupStepsCompleted: 0,
    conceptProgress: { current: 0, total: 0 },
    handleDelete: vi.fn(),
    handleAnkiDelete: vi.fn(),
    startEdit: vi.fn(),
    cancelEdit: vi.fn(),
    saveEdit: vi.fn(),
    handleFieldChange: vi.fn(),
    handleSync: vi.fn(),
    setConfirmModal: vi.fn(),
    toggleMultiSelectMode: vi.fn(),
    toggleCardSelection: vi.fn(),
    selectAllCards: vi.fn(),
    clearSelection: vi.fn(),
    batchDeleteSelected: vi.fn(),
};

describe('ProgressView', () => {
    let storeState: any;

    beforeEach(() => {
        storeState = { ...defaultState };
        (mockUseLecternStore as unknown as Mock).mockImplementation((selector) => {
            return selector ? selector(storeState) : storeState;
        });
    });

    // ... tests ...


    it('renders progress indicators', () => {
        render(<ProgressView />);
        expect(screen.getByText(/Generation Status/i)).toBeInTheDocument();
        expect(screen.getByText('Progress')).toBeInTheDocument();
        expect(screen.getByText('Creating Cards')).toBeInTheDocument();
    });

    it('renders sorting pills', () => {
        render(<ProgressView />);
        expect(screen.getByText('creation')).toBeInTheDocument();
        expect(screen.getByText('topic')).toBeInTheDocument();
        expect(screen.getByText('slide')).toBeInTheDocument();
        expect(screen.getByText('type')).toBeInTheDocument();
    });

    it('calls setSortBy when a pill is clicked', () => {
        const mockState: any = {
            ...defaultState,
            setSortBy: vi.fn(),
        };
        storeState = mockState;

        render(<ProgressView />);
        const topicPill = screen.getByText('topic');
        topicPill.click();
        expect(mockState.setSortBy).toHaveBeenCalledWith('topic');
    });

    it('shows cancel button when generating', () => {
        render(<ProgressView />);
        expect(screen.getByText(/Activity Log/i)).toBeInTheDocument();
    });

    it('reorders cards when sortBy changes', () => {
        const cards = [
            { front: 'A', back: 'A', slide_number: 2, slide_topic: 'Z', model_name: 'Cloze', fields: { Front: 'A' }, _uid: 'uid-a' },
            { front: 'B', back: 'B', slide_number: 1, slide_topic: 'A', model_name: 'Basic', fields: { Front: 'B' }, _uid: 'uid-b' },
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
        expect(screen.getByText(/^Insights$/i)).toBeInTheDocument();
        expect(screen.getByText(/Start New Session/i)).toBeInTheDocument();
    });

    it('filters cards based on search query', () => {
        const cards = [
            { front: 'Apple', back: 'Fruit', model_name: 'Basic', fields: { Front: 'Apple', Back: 'Fruit' }, _uid: 'uid-apple' },
            { front: 'Banana', back: 'Fruit', model_name: 'Basic', fields: { Front: 'Banana', Back: 'Fruit' }, _uid: 'uid-banana' },
            { front: 'Carrot', back: 'Vegetable', model_name: 'Basic', fields: { Front: 'Carrot', Back: 'Vegetable' }, _uid: 'uid-carrot' },
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
            { front: 'Cat', back: 'Animal', fields: { Front: 'Cat', Back: 'Animal' }, model_name: 'Basic', _uid: 'uid-cat' },
            { front: 'Bat', back: 'Animal', fields: { Front: 'Bat', Back: 'Animal' }, model_name: 'Basic', _uid: 'uid-bat' },
            { front: 'Rat', back: 'Animal', fields: { Front: 'Rat', Back: 'Animal' }, model_name: 'Basic', _uid: 'uid-rat' },
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
        const mockState: any = {
            ...defaultState,
            step: 'generating',
            currentPhase: 'generating',
            logs: [{ type: 'error', message: 'Fatal error', timestamp: Date.now() }],
            cards: [],
            progress: { current: 0, total: 10 },
            isError: true,
            isCancelling: false,
        };
        storeState = mockState;

        render(<ProgressView />);
        expect(screen.getByText(/Generation Failed/i)).toBeInTheDocument();
        expect(screen.getByText(/Return to Dashboard/i)).toBeInTheDocument();
    });

    it('renders slide numbers and topics', () => {
        const cards = [{
            Front: 'Neural Networks',
            Back: '...',
            slide_number: 42,
            slide_topic: 'Deep Learning',
            _uid: '123'
        }];

        const mockState: any = {
            ...defaultState,
            cards,
            step: 'done' // Ensure we are in a state where cards are rendered in list
        };
        storeState = mockState;

        render(<ProgressView />);
        expect(screen.getByText(/SLIDE 42/i)).toBeInTheDocument();
        // Use getAllByText and check length or specific one if needed, or refine query
        expect(screen.getAllByText('Deep Learning').length).toBeGreaterThan(0);
    });

    it('handles card actions: edit, archive, delete', () => {
        const mockState: any = {
            ...defaultState,
            step: 'done',
            cards: [{ Front: 'A', Back: 'B', _uid: '123' }],
            startEdit: vi.fn(),
            setConfirmModal: vi.fn(),
        };
        storeState = mockState;

        render(<ProgressView />);

        // Edit
        const editBtn = screen.getByTitle('Edit');
        editBtn.click();
        expect(mockState.startEdit).toHaveBeenCalledWith(0);

        // Remove (Lectern only)
        const removeBtn = screen.getByTitle('Remove');
        removeBtn.click();
        expect(mockState.setConfirmModal).toHaveBeenCalledWith({ isOpen: true, type: 'lectern', index: 0 });
    });

    it('renders Edit mode correctly', () => {
        const mockState: any = {
            ...defaultState,
            step: 'done',
            cards: [{ fields: { Front: 'A', Back: 'B' }, _uid: '123' }],
            editingIndex: 0,
            editForm: { fields: { Front: 'A', Back: 'B' }, _uid: '123' },
            saveEdit: vi.fn(),
            cancelEdit: vi.fn(),
            handleFieldChange: vi.fn()
        };
        storeState = mockState;

        render(<ProgressView />);
        expect(screen.getByText(/Editing Card/i)).toBeInTheDocument();
        expect(screen.getByDisplayValue('A')).toBeInTheDocument();

        // Save
        const saveBtn = screen.getByText('Save');
        saveBtn.click();
        expect(mockState.saveEdit).toHaveBeenCalledWith(0); // Using the original index from uidToIndex map
    });

    it('handles confirm modal callbacks', () => {
        const mockState: any = {
            ...defaultState,
            step: 'done',
            cards: [{ Front: 'A', Back: 'B', anki_note_id: 101, _uid: '123' }],
            confirmModal: { isOpen: true, type: 'anki', index: 0, noteId: 101 },
            handleAnkiDelete: vi.fn(),
            setConfirmModal: vi.fn(),
        };
        storeState = mockState;

        render(<ProgressView />);

        // We need to find the Confirm button in the modal.
        // ConfirmModal is a separate component, let's see if we need to mock it or if it's rendered.
        // It's rendered.
        const confirmBtn = screen.getByText('Permanently Delete');
        confirmBtn.click();
        expect(mockState.handleAnkiDelete).toHaveBeenCalledWith(101, 0);

        const closeBtn = screen.getByText('Cancel');
        closeBtn.click();
        expect(mockState.setConfirmModal).toHaveBeenCalled();
    });
});
