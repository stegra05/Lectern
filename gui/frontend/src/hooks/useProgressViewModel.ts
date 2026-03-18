import { useMemo } from 'react';
import { useShallow } from 'zustand/shallow';
import { useLecternStore } from '../store';
import { useLecternActions } from './useLecternSelectors';

import {
    selectStep,
    selectCurrentPhase,
    selectProgress,
    selectConceptProgress,
    selectSetupStepsCompleted,
    selectCards,
    selectIsSyncing,
    selectSyncSuccess,
    selectSyncPartialFailure,
    selectSyncProgress,
    selectSyncLogs,
    selectSortBy,
    selectSearchQuery,
    selectIsMultiSelectMode,
    selectSelectedCards,
    selectProgressPct,
} from '../selectors';

export function useProgressViewModel() {
    const actions = useLecternActions();
    
    // Subscribe to all needed raw state via shallow comparison
    const stateSlice = useLecternStore(useShallow((s) => ({
        isCancelling: s.isCancelling,
        isHistorical: s.isHistorical,
        sessionId: s.sessionId,
        totalPages: s.totalPages,
        coverageData: s.coverageData,
        rubricSummary: s.rubricSummary,
        isError: s.isError,
        logs: s.logs,
        copied: s.copied,
        editingIndex: s.editingIndex,
        editForm: s.editForm,
        confirmModal: s.confirmModal,
    })));

    // Individual selector subscriptions for derived or potentially stable values
    const step = useLecternStore(selectStep);
    const currentPhase = useLecternStore(selectCurrentPhase);
    const progress = useLecternStore(selectProgress);
    const conceptProgress = useLecternStore(selectConceptProgress);
    const setupStepsCompleted = useLecternStore(selectSetupStepsCompleted);
    const allCards = useLecternStore(selectCards);
    const progressPct = useLecternStore(selectProgressPct);
    
    const isSyncing = useLecternStore(selectIsSyncing);
    const syncSuccess = useLecternStore(selectSyncSuccess);
    const syncPartialFailure = useLecternStore(selectSyncPartialFailure);
    const syncProgress = useLecternStore(selectSyncProgress);
    const syncLogs = useLecternStore(selectSyncLogs);
    
    const sortBy = useLecternStore(selectSortBy);
    const searchQuery = useLecternStore(selectSearchQuery);
    const isMultiSelectMode = useLecternStore(selectIsMultiSelectMode);
    const selectedCards = useLecternStore(selectSelectedCards);

    return useMemo(() => ({
        // State
        state: {
            session: {
                step,
                currentPhase,
                isCancelling: stateSlice.isCancelling,
                isHistorical: stateSlice.isHistorical,
                sessionId: stateSlice.sessionId,
                totalPages: stateSlice.totalPages,
                coverageData: stateSlice.coverageData,
                rubricSummary: stateSlice.rubricSummary,
                isError: stateSlice.isError,
            },
            logs: {
                logs: stateSlice.logs,
                copied: stateSlice.copied,
            },
            progress: {
                progress,
                conceptProgress,
                setupStepsCompleted,
                progressPct,
            },
            cards: {
                cards: allCards,
                editingIndex: stateSlice.editingIndex,
                editForm: stateSlice.editForm,
            },
            sync: {
                isSyncing,
                syncSuccess,
                syncPartialFailure,
                syncProgress,
                syncLogs,
            },
            ui: {
                sortBy,
                searchQuery,
                isMultiSelectMode,
                selectedCards,
                confirmModal: stateSlice.confirmModal,
            }
        },
        // Actions
        actions,
    }), [stateSlice, actions, step, currentPhase, progress, conceptProgress, setupStepsCompleted, allCards, progressPct, isSyncing, syncSuccess, syncPartialFailure, syncProgress, syncLogs, sortBy, searchQuery, isMultiSelectMode, selectedCards]);
}
