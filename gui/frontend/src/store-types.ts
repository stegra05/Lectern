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

    // Review / Sync
    isHistorical: boolean;
    editingIndex: number | null;
    editForm: Card | null;
    isSyncing: boolean;
    syncSuccess: boolean;
    syncProgress: { current: number; total: number };
    syncLogs: ProgressEvent[];
    confirmModal: ConfirmModalState;
    searchQuery: string;
    sortBy: SortOption;

    // UI bits
    copied: boolean;

    // Toast
    toasts: StoreToast[];

    // Progress tracking
    setupStepsCompleted: number;
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
};

export type UiActions = {
    setSearchQuery: (query: string) => void;
    setSortBy: (option: SortOption) => void;
};

export type ToastActions = {
    addToast: (type: ToastType, message: string, duration?: number) => void;
    dismissToast: (id: string) => void;
};

export type ProgressTrackingActions = {
    incrementSetupStep: () => void;
};

export type StoreActions = GenerationActions & ReviewActions & UiActions & ToastActions & ProgressTrackingActions;
export type LecternStore = StoreState & StoreActions;
