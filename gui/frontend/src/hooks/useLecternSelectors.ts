import { useLecternStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import type { Phase } from '../components/PhaseIndicator';

/**
 * Optimized selector hooks for Zustand store.
 *
 * These hooks subscribe to specific slices of state to minimize re-renders.
 * Grouped by update frequency:
 * - Fast-changing: logs, progress (update frequently during generation)
 * - Slow-changing: cards, editing (update less frequently)
 * - Stable: actions (never change, safe to get all at once)
 */

// ---------------------------------------------------------------------------
// Fast-changing state (logs, progress) - updates frequently during generation
// ---------------------------------------------------------------------------

/** State for activity log display */
export const useLogsState = () => useLecternStore(useShallow((s) => ({
    logs: s.logs,
    copied: s.copied,
})));

/** State for progress indicators */
export const useProgressState = () => useLecternStore(useShallow((s) => ({
    progress: s.progress,
    conceptProgress: s.conceptProgress,
    currentPhase: s.currentPhase,
    setupStepsCompleted: s.setupStepsCompleted,
    cardsLength: s.cards.length,
})));

// ---------------------------------------------------------------------------
// Slow-changing state (cards, editing) - updates less frequently
// ---------------------------------------------------------------------------

/** State for card list and editing */
export const useCardsState = () => useLecternStore(useShallow((s) => ({
    cards: s.cards,
    editingIndex: s.editingIndex,
    editForm: s.editForm,
})));

/** State for sync operations */
export const useSyncState = () => useLecternStore(useShallow((s) => ({
    isSyncing: s.isSyncing,
    syncSuccess: s.syncSuccess,
    syncPartialFailure: s.syncPartialFailure,
    syncProgress: s.syncProgress,
    syncLogs: s.syncLogs,
})));

/** State for UI controls (search, sort, selection) */
export const useUIState = () => useLecternStore(useShallow((s) => ({
    sortBy: s.sortBy,
    searchQuery: s.searchQuery,
    isMultiSelectMode: s.isMultiSelectMode,
    selectedCards: s.selectedCards,
})));

/** State for session/step info */
export const useSessionState = () => useLecternStore(useShallow((s) => ({
    step: s.step,
    currentPhase: s.currentPhase as Phase,
    isError: s.isError,
    isCancelling: s.isCancelling,
    isHistorical: s.isHistorical,
    sessionId: s.sessionId,
    totalPages: s.totalPages,
})));

/** State for confirmation modal */
export const useConfirmModalState = () => useLecternStore(useShallow((s) => ({
    confirmModal: s.confirmModal,
})));

// ---------------------------------------------------------------------------
// Individual selectors for specific values (most granular)
// ---------------------------------------------------------------------------

export const useStep = () => useLecternStore((s) => s.step);
export const useCurrentPhase = () => useLecternStore((s) => s.currentPhase);
export const useIsError = () => useLecternStore((s) => s.isError);
export const useIsCancelling = () => useLecternStore((s) => s.isCancelling);
export const useIsHistorical = () => useLecternStore((s) => s.isHistorical);
export const useSessionId = () => useLecternStore((s) => s.sessionId);
export const useTotalPages = () => useLecternStore((s) => s.totalPages);
export const useCards = () => useLecternStore((s) => s.cards);
export const useIsSyncing = () => useLecternStore((s) => s.isSyncing);
export const useSyncSuccess = () => useLecternStore((s) => s.syncSuccess);
export const useSyncPartialFailure = () => useLecternStore((s) => s.syncPartialFailure);
export const useSyncProgress = () => useLecternStore((s) => s.syncProgress);
export const useSyncLogs = () => useLecternStore((s) => s.syncLogs);

// ---------------------------------------------------------------------------
// Actions (stable references - safe to get all at once)
// ---------------------------------------------------------------------------

/** All store actions - stable references, won't cause re-renders */
export const useLecternActions = () => useLecternStore(useShallow((s) => ({
    // Generation actions
    handleCopyLogs: s.handleCopyLogs,
    handleCancel: s.handleCancel,
    handleReset: s.handleReset,

    // Review actions
    handleDelete: s.handleDelete,
    handleAnkiDelete: s.handleAnkiDelete,
    startEdit: s.startEdit,
    cancelEdit: s.cancelEdit,
    saveEdit: s.saveEdit,
    handleFieldChange: s.handleFieldChange,
    handleSync: s.handleSync,
    setConfirmModal: s.setConfirmModal,

    // UI actions
    setSortBy: s.setSortBy,
    setSearchQuery: s.setSearchQuery,

    // Batch actions
    toggleMultiSelectMode: s.toggleMultiSelectMode,
    toggleCardSelection: s.toggleCardSelection,
    selectCardRange: s.selectCardRange,
    selectAllCards: s.selectAllCards,
    clearSelection: s.clearSelection,
    batchDeleteSelected: s.batchDeleteSelected,
})));
