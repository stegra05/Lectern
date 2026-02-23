import type { ProgressEvent, Card, Estimation } from './api';
import type { Phase } from './components/PhaseIndicator';
export type { Phase };
import type { SortOption } from './hooks/types';
import type { ToastType } from './components/Toast';

export interface StoreToast {
    id: string;
    type: ToastType;
    message: string;
    duration?: number;
    /** Optional undo action callback */
    onUndo?: () => void;
    undoLabel?: string;
}

/** Buffer entry for deleted cards that can be undone */
export interface DeletedCardBuffer {
    card: Card;
    originalIndex: number;
    deletedAt: number;
    timeoutId: ReturnType<typeof setTimeout> | null;
}

export type Step = 'dashboard' | 'config' | 'generating' | 'done';

export type ConfirmModalState = {
    isOpen: boolean;
    type: 'lectern' | 'anki';
    index: number;
    noteId?: number;
};

export type StoreState = {
    // Generation
    step: Step;
    pdfFile: File | null;
    deckName: string;
    focusPrompt: string;
    sourceType: 'auto' | 'slides' | 'script';
    targetDeckSize: number;
    logs: ProgressEvent[];
    cards: Card[];
    progress: { current: number; total: number };
    currentPhase: Phase;
    sessionId: string | null;
    isError: boolean;
    isCancelling: boolean;
    estimation: Estimation | null;
    isEstimating: boolean;
    estimationError: string | null;
    totalPages: number;

    // Review / Sync
    isHistorical: boolean;
    editingIndex: number | null;
    editForm: Card | null;
    isSyncing: boolean;
    syncSuccess: boolean;
    syncPartialFailure: { failed: number; created: number } | null;
    syncProgress: { current: number; total: number };
    syncLogs: ProgressEvent[];
    confirmModal: ConfirmModalState;
    searchQuery: string;
    sortBy: SortOption;

    // Batch operations
    isMultiSelectMode: boolean;
    selectedCards: Set<string>;

    // UI bits
    copied: boolean;

    // Toast
    toasts: StoreToast[];

    // Progress tracking
    setupStepsCompleted: number;

    // Concept phase progress (slide-by-slide analysis)
    conceptProgress: { current: number; total: number };

    // Undo buffer for deleted cards
    deletedCards: DeletedCardBuffer[];
    batchDeletedCards: DeletedCardBuffer[];

    // Budget tracking
    totalSessionSpend: number;
    budgetLimit: number | null;
};

export type GenerationActions = {
    setStep: (step: Step) => void;
    setPdfFile: (file: File | null) => void;
    setDeckName: (name: string) => void;
    setFocusPrompt: (prompt: string) => void;
    setSourceType: (type: 'auto' | 'slides' | 'script') => void;
    setTargetDeckSize: (target: number) => void;
    setEstimation: (est: Estimation | null) => void;
    setIsEstimating: (value: boolean) => void;
    setEstimationError: (error: string | null) => void;
    setTotalPages: (n: number) => void;
    setIsError: (value: boolean) => void;
    setIsCancelling: (value: boolean) => void;
    setSessionId: (id: string | null) => void;
    setPhaseFromEvent: (event: ProgressEvent) => void;
    setProgress: (update: { current?: number; total?: number }) => void;
    appendLog: (event: ProgressEvent) => void;
    appendCard: (card: Card) => void;
    handleGenerate: () => Promise<void>;
    handleCancel: () => void;
    handleReset: () => void;
    handleCopyLogs: () => void;
    loadSession: (sessionId: string) => Promise<void>;
    recoverSessionOnRefresh: () => Promise<void>;
    refreshRecoveredSession: () => Promise<void>;
    recommendTargetDeckSize: (est: Estimation) => void;
    reset: () => void;
};

export type ReviewActions = {
    setIsHistorical: (value: boolean) => void;
    setConfirmModal: (modal: ConfirmModalState) => void;
    setEditingIndex: (index: number | null) => void;
    setEditForm: (card: Card | null) => void;
    setSyncProgress: (progress: { current: number; total: number }) => void;
    setSyncLogs: (logs: ProgressEvent[]) => void;
    startEdit: (index: number) => void;
    cancelEdit: () => void;
    saveEdit: (index: number) => Promise<void>;
    handleFieldChange: (field: string, value: string) => void;
    handleDelete: (index: number) => Promise<void>;
    handleAnkiDelete: (noteId: number, index: number) => Promise<void>;
    handleSync: () => Promise<void>;
    /** Restore a deleted card from the buffer */
    undoDelete: (cardUid: string) => void;
    /** Clear a deleted card from the buffer (called after timeout) */
    clearDeletedCard: (cardUid: string) => void;
};

export type UiActions = {
    setSearchQuery: (query: string) => void;
    setSortBy: (option: SortOption) => void;
};

export type BatchActions = {
    toggleMultiSelectMode: () => void;
    toggleCardSelection: (cardUid: string) => void;
    selectAllCards: () => void;
    clearSelection: () => void;
    batchDeleteSelected: () => Promise<void>;
    undoBatchDelete: () => void;
    clearBatchDeletedCard: (cardUid: string) => void;
};

export type ToastActions = {
    addToast: (type: ToastType, message: string, duration?: number, onUndo?: () => void, undoLabel?: string) => void;
    dismissToast: (id: string) => void;
};

export type ProgressTrackingActions = {
    incrementSetupStep: () => void;
    setConceptProgress: (progress: { current: number; total: number }) => void;
};

export type BudgetActions = {
    /** Add spent amount to session total */
    addToSessionSpend: (amount: number) => void;
    /** Reset session spend to zero */
    resetSessionSpend: () => void;
    /** Set budget limit (null to disable) */
    setBudgetLimit: (limit: number | null) => void;
    /** Check if spending would exceed budget */
    wouldExceedBudget: (amount: number) => boolean;
};

export type StoreActions = GenerationActions & ReviewActions & UiActions & ToastActions & ProgressTrackingActions & BatchActions & BudgetActions;
export type LecternStore = StoreState & StoreActions;
