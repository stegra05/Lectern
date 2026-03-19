import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProgressView } from '../views/ProgressView';
import type { Phase } from '../components/PhaseIndicator';
import type { Step } from '../store-types';
import type { SortOption } from '../hooks/types';
import type { Card, ProgressEvent } from '../api';
import React from 'react';

// Mock useTrickleProgress to skip animation
vi.mock('../hooks/useTrickleProgress', () => ({
    useTrickleProgress: (val: number) => ({ display: val, isStalled: false })
}));

// Mock useTimeEstimate
vi.mock('../hooks/useTimeEstimate', () => ({
    useTimeEstimate: () => ({ formatted: null, confidence: 'low' })
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

// Mock scrollIntoView
window.HTMLElement.prototype.scrollIntoView = vi.fn();

const { defaultState, storeState } = vi.hoisted(() => {
    const defaultStateObj = {
        step: 'generating' as Step,
        currentPhase: 'generating' as Phase,
        logs: [] as ProgressEvent[],
        cards: [] as Card[],
        progress: { current: 0, total: 10 },
        isError: false,
        isCancelling: false,
        handleCopyLogs: vi.fn(),
        handleCancel: vi.fn(),
        handleReset: vi.fn(),
        sortBy: 'creation' as SortOption,
        searchQuery: '',
        isHistorical: false,
        editingIndex: null as number | null,
        editForm: null as Card | null,
        isSyncing: false,
        syncSuccess: false,
        syncPartialFailure: null as { failed: number; created: number } | null,
        syncProgress: { current: 0, total: 0 },
        syncLogs: [] as ProgressEvent[],
        confirmModal: { isOpen: false, type: 'lectern' as const, index: -1, noteId: undefined as number | undefined },
        isMultiSelectMode: false,
        selectedCards: new Set<string>(),
        setupStepsCompleted: 0,
        conceptProgress: { current: 0, total: 0 },
        handleDelete: vi.fn(),
        handleAnkiDelete: vi.fn(),
        startEdit: vi.fn(),
        cancelEdit: vi.fn(),
        saveEdit: vi.fn(),
        handleFieldChange: vi.fn(),
        handleFeedbackChange: vi.fn(),
        handleSync: vi.fn(),
        handleSyncPreview: vi.fn(),
        setConfirmModal: vi.fn(),
        toggleMultiSelectMode: vi.fn(),
        toggleCardSelection: vi.fn(),
        selectAllCards: vi.fn(),
        clearSelection: vi.fn(),
        batchDeleteSelected: vi.fn(),
        setStep: vi.fn(),
        setSortBy: vi.fn(),
        setSearchQuery: vi.fn(),
        totalPages: 0,
        coverageData: null,
        rubricSummary: null as {
            avg_quality: number;
            min_quality: number;
            max_quality: number;
            below_threshold_count: number;
            total_cards: number;
            threshold: number;
        } | null,
        copied: false,
        sessionId: null as string | null,
    };
    
    return {
        defaultState: defaultStateObj,
        storeState: { ...defaultStateObj }
    };
});

const mockUseLecternStore = vi.fn((selector: ((s: typeof storeState) => unknown) | undefined) => {
    // Pass a shallow clone to selectors to ensure reselect (and other memoized selectors)
    // recognize that the state might have been mutated in-place in tests.
    return selector ? selector({ ...storeState }) : storeState;
});

vi.mock('../store', () => ({
    useLecternStore: (selector?: (s: typeof storeState) => unknown) => mockUseLecternStore(selector),
}));

vi.mock('../hooks/useReviewOrchestrator', () => ({
    useReviewOrchestrator: () => ({
        saveEdit: storeState.saveEdit,
        handleSync: storeState.handleSync,
        handleSyncPreview: storeState.handleSyncPreview,
        handleAnkiDelete: storeState.handleAnkiDelete,
    }),
}));

// Mock the new view model directly and map our storeState mock to its expected output shape dynamically
vi.mock('../hooks/useProgressViewModel', () => {
    return {
        useProgressViewModel: () => {
            // This hook is called per render in the tests.
            // We need to return an object built from the CURRENT storeState, not the initial one.
            return {
                state: {
                    session: {
                        step: storeState.step,
                        currentPhase: storeState.currentPhase,
                        isCancelling: storeState.isCancelling,
                        isHistorical: storeState.isHistorical,
                        sessionId: storeState.sessionId,
                        totalPages: storeState.totalPages,
                        coverageData: storeState.coverageData,
                        rubricSummary: (storeState as typeof storeState & { rubricSummary?: unknown }).rubricSummary ?? null,
                        isError: storeState.isError,
                    },
                    logs: {
                        logs: storeState.logs,
                        copied: storeState.copied,
                    },
                    progress: {
                        progress: storeState.progress,
                        conceptProgress: storeState.conceptProgress,
                        setupStepsCompleted: storeState.setupStepsCompleted,
                    },
                    cards: {
                        cards: storeState.cards,
                        editingIndex: storeState.editingIndex,
                        editForm: storeState.editForm,
                    },
                    sync: {
                        isSyncing: storeState.isSyncing,
                        syncSuccess: storeState.syncSuccess,
                        syncPartialFailure: storeState.syncPartialFailure,
                        syncProgress: storeState.syncProgress,
                        syncLogs: storeState.syncLogs,
                    },
                    ui: {
                        sortBy: storeState.sortBy,
                        searchQuery: storeState.searchQuery,
                        isMultiSelectMode: storeState.isMultiSelectMode,
                        selectedCards: storeState.selectedCards,
                        confirmModal: storeState.confirmModal,
                    }
                },
                actions: {
                    handleCopyLogs: storeState.handleCopyLogs,
                    handleCancel: storeState.handleCancel,
                    handleReset: storeState.handleReset,
                    setSortBy: storeState.setSortBy,
                    setSearchQuery: storeState.setSearchQuery,
                    startEdit: storeState.startEdit,
                    cancelEdit: storeState.cancelEdit,
                    saveEdit: storeState.saveEdit,
                    handleFieldChange: storeState.handleFieldChange,
                    handleFeedbackChange: storeState.handleFeedbackChange,
                    handleSync: storeState.handleSync,
                    dismissSyncSuccess: vi.fn(),
                    dismissSyncPartialFailure: vi.fn(),
                    handleDelete: storeState.handleDelete,
                    handleAnkiDelete: storeState.handleAnkiDelete,
                    setConfirmModal: storeState.setConfirmModal,
                    toggleMultiSelectMode: storeState.toggleMultiSelectMode,
                    toggleCardSelection: storeState.toggleCardSelection,
                    selectAllCards: storeState.selectAllCards,
                    clearSelection: storeState.clearSelection,
                    batchDeleteSelected: storeState.batchDeleteSelected,
                }
            };
        }
    };
});

describe('ProgressView', () => {
    beforeEach(() => {
        Object.assign(storeState, defaultState);
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
        Object.assign(storeState, { setSortBy: vi.fn() });

        render(<ProgressView />);
        const topicPill = screen.getByText('topic');
        topicPill.click();
        expect(storeState.setSortBy).toHaveBeenCalledWith('topic');
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
        Object.assign(storeState, { cards, sortBy: 'slide' });
        const { rerender } = render(<ProgressView />);
        const slideTexts = screen.getAllByText(/SLIDE \d/i).map(el => el.textContent);
        expect(slideTexts).toEqual(['SLIDE 1', 'SLIDE 2']);

        // Test topic sorting
        Object.assign(storeState, { cards, sortBy: 'topic' });
        rerender(<ProgressView />);
        let cardTypes = screen.getAllByText(/Basic|Cloze/i).filter(el => el.tagName === 'SPAN').map(el => el.textContent);
        // Topic 'A' has model 'Basic', Topic 'Z' has model 'Cloze' -> Order should be Basic, Cloze
        expect(cardTypes).toEqual(['Basic', 'Cloze']);

        // Test type sorting
        Object.assign(storeState, { cards, sortBy: 'type' });
        rerender(<ProgressView />);
        cardTypes = screen.getAllByText(/Basic|Cloze/i).filter(el => el.tagName === 'SPAN').map(el => el.textContent);
        // Basic < Cloze -> Order should be Basic, Cloze
        expect(cardTypes).toEqual(['Basic', 'Cloze']);
    });

    it('shows completion state correctly', () => {
        Object.assign(storeState, {
            step: 'done' as const,
            currentPhase: 'complete' as Phase,
            progress: { current: 10, total: 10 },
        });
        render(<ProgressView />);
        expect(screen.getByText(/^Insights$/i)).toBeInTheDocument();
        expect(screen.getByText(/Start New Session/i)).toBeInTheDocument();
    });

    it('renders rubric summary insight when available', () => {
        Object.assign(storeState, {
            step: 'done' as const,
            rubricSummary: {
                avg_quality: 55.2,
                min_quality: 30,
                max_quality: 88,
                below_threshold_count: 3,
                total_cards: 12,
                threshold: 60,
            },
        });
        render(<ProgressView />);
        expect(screen.getByText(/Rubric Quality/i)).toBeInTheDocument();
        expect(screen.getByText(/55.2/)).toBeInTheDocument();
    });

    it('filters cards based on search query', () => {
        const cards = [
            { front: 'Apple', back: 'Fruit', model_name: 'Basic', fields: { Front: 'Apple', Back: 'Fruit' }, _uid: 'uid-apple' },
            { front: 'Banana', back: 'Fruit', model_name: 'Basic', fields: { Front: 'Banana', Back: 'Fruit' }, _uid: 'uid-banana' },
            { front: 'Carrot', back: 'Vegetable', model_name: 'Basic', fields: { Front: 'Carrot', Back: 'Vegetable' }, _uid: 'uid-carrot' },
        ];

        // Match "Apple"
        Object.assign(storeState, { cards, searchQuery: 'Apple' });
        const { rerender } = render(<ProgressView />);
        expect(screen.getByText('Apple')).toBeInTheDocument();
        expect(screen.queryByText('Banana')).not.toBeInTheDocument();
        expect(screen.queryByText('Carrot')).not.toBeInTheDocument();

        // Match "fruit" (case insensitive)
        Object.assign(storeState, { cards, searchQuery: 'fruit' });
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
        Object.assign(storeState, { cards, searchQuery: '/^[CB]at/' });
        render(<ProgressView />);
        expect(screen.getByText('Cat')).toBeInTheDocument();
        expect(screen.getByText('Bat')).toBeInTheDocument();
        expect(screen.queryByText('Rat')).not.toBeInTheDocument();
    });

    it('passes visible card uids when selecting all in multi-select mode', () => {
        Object.assign(storeState, {
            step: 'done',
            isMultiSelectMode: true,
            searchQuery: 'Apple',
            selectAllCards: vi.fn(),
            cards: [
                { front: 'Apple', back: 'Fruit', fields: { Front: 'Apple', Back: 'Fruit' }, model_name: 'Basic', _uid: 'uid-apple' },
                { front: 'Banana', back: 'Fruit', fields: { Front: 'Banana', Back: 'Fruit' }, model_name: 'Basic', _uid: 'uid-banana' },
                { front: 'Carrot', back: 'Vegetable', fields: { Front: 'Carrot', Back: 'Vegetable' }, model_name: 'Basic', _uid: 'uid-carrot' },
            ],
        });

        render(<ProgressView />);
        screen.getByText('Select All (1)').click();

        expect(storeState.selectAllCards).toHaveBeenCalledWith(['uid-apple']);
    });

    it('requests sync preview before syncing', () => {
        Object.assign(storeState, {
            step: 'done',
            cards: [{ front: 'Apple', back: 'Fruit', fields: { Front: 'Apple', Back: 'Fruit' }, model_name: 'Basic', _uid: 'uid-apple' }],
            handleSyncPreview: vi.fn().mockResolvedValue({
                total_cards: 1,
                create_candidates: 1,
                update_candidates: 0,
                existing_note_matches: 0,
                missing_note_ids: 0,
                invalid_note_ids: 0,
                conflict_count: 0,
                note_lookup_error: null,
            }),
        });

        render(<ProgressView />);
        screen.getByRole('button', { name: 'Preview Sync' }).click();

        expect(storeState.handleSyncPreview).toHaveBeenCalledTimes(1);
    });
    it('shows sync overlay when isSyncing is true', () => {
        Object.assign(storeState, {
            isSyncing: true,
            syncProgress: { current: 1, total: 2 },
            syncLogs: [{ type: 'status' as const, message: 'Uploading...', timestamp: Date.now() }],
        });
        render(<ProgressView />);
        expect(screen.getByText(/Syncing to Anki/i)).toBeInTheDocument();
        expect(screen.getByText('50%')).toBeInTheDocument();
        expect(screen.getByText('Uploading...')).toBeInTheDocument();
    });

    it('shows success overlay when syncSuccess is true', () => {
        Object.assign(storeState, { syncSuccess: true });
        render(<ProgressView />);
        expect(screen.getByText(/Sync Complete/i)).toBeInTheDocument();
    });

    it('shows error overlay when isError is true', () => {
        Object.assign(storeState, {
            step: 'generating',
            currentPhase: 'generating',
            logs: [{ type: 'error', message: 'Fatal error', timestamp: Date.now() }],
            cards: [],
            progress: { current: 0, total: 10 },
            isError: true,
            isCancelling: false,
        });

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

        Object.assign(storeState, {
            cards,
            step: 'done' // Ensure we are in a state where cards are rendered in list
        });

        render(<ProgressView />);
        expect(screen.getByText(/SLIDE 42/i)).toBeInTheDocument();
        // Use getAllByText and check length or specific one if needed, or refine query
        expect(screen.getAllByText('Deep Learning').length).toBeGreaterThan(0);
    });

    it('handles card actions: edit, archive, delete', () => {
        Object.assign(storeState, {
            step: 'done',
            cards: [{ Front: 'A', Back: 'B', _uid: '123' }],
            startEdit: vi.fn(),
            setConfirmModal: vi.fn(),
        });

        render(<ProgressView />);

        // Edit
        const editBtn = screen.getByTitle('Edit');
        editBtn.click();
        expect(storeState.startEdit).toHaveBeenCalledWith(0);

        // Remove (Lectern only)
        const removeBtn = screen.getByTitle('Remove');
        removeBtn.click();
        expect(storeState.setConfirmModal).toHaveBeenCalledWith({ isOpen: true, type: 'lectern', index: 0 });
    });

    it('renders Edit mode correctly', () => {
        Object.assign(storeState, {
            step: 'done',
            cards: [{ fields: { Front: 'A', Back: 'B' }, _uid: '123' }],
            editingIndex: 0,
            editForm: { fields: { Front: 'A', Back: 'B' }, _uid: '123' },
            saveEdit: vi.fn(),
            cancelEdit: vi.fn(),
            handleFieldChange: vi.fn(),
            handleFeedbackChange: vi.fn(),
        });

        render(<ProgressView />);
        expect(screen.getByText(/Editing Card/i)).toBeInTheDocument();
        expect(screen.getByDisplayValue('A')).toBeInTheDocument();

        // Save
        const saveBtn = screen.getByText('Save');
        saveBtn.click();
        expect(storeState.saveEdit).toHaveBeenCalledWith(0); // Using the original index from uidToIndex map
    });

    it('handles confirm modal callbacks', () => {
        Object.assign(storeState, {
            step: 'done',
            cards: [{ Front: 'A', Back: 'B', anki_note_id: 101, _uid: '123' }],
            confirmModal: { isOpen: true, type: 'anki', index: 0, noteId: 101 },
            handleAnkiDelete: vi.fn(),
            setConfirmModal: vi.fn(),
        });

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
