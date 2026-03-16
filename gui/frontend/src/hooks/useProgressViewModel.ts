import { useMemo } from 'react';
import { useShallow } from 'zustand/shallow';
import { useLecternStore } from '../store';
import { useLecternActions } from './useLecternSelectors';

import { calculateProgressPercentage } from '../logic/progress';

export function useProgressViewModel() {
    const actions = useLecternActions();
    
    // Select specific state slice with shallow comparison
    const stateSlice = useLecternStore(useShallow((s) => ({
        step: s.step,
        currentPhase: s.currentPhase,
        isCancelling: s.isCancelling,
        isHistorical: s.isHistorical,
        sessionId: s.sessionId,
        totalPages: s.totalPages,
        coverageData: s.coverageData,
        isError: s.isError,
        logs: s.logs,
        copied: s.copied,
        progress: s.progress,
        conceptProgress: s.conceptProgress,
        setupStepsCompleted: s.setupStepsCompleted,
        cards: s.cards,
        editingIndex: s.editingIndex,
        editForm: s.editForm,
        isSyncing: !!s.isSyncing,
        syncSuccess: s.syncSuccess,
        syncPartialFailure: s.syncPartialFailure,
        syncProgress: s.syncProgress,
        syncLogs: s.syncLogs,
        sortBy: s.sortBy,
        searchQuery: s.searchQuery,
        isMultiSelectMode: s.isMultiSelectMode,
        selectedCards: s.selectedCards,
        confirmModal: s.confirmModal,
    })));

    const progressPct = useMemo(() => {
        if (stateSlice.step !== 'generating' && stateSlice.step !== 'done') return 0;
        return calculateProgressPercentage({
            currentPhase: stateSlice.currentPhase,
            step: stateSlice.step as 'generating' | 'done',
            cardsLength: stateSlice.cards.length,
            progressTotal: stateSlice.progress.total,
            progressCurrent: stateSlice.progress.current,
            conceptProgress: stateSlice.conceptProgress,
            setupStepsCompleted: stateSlice.setupStepsCompleted,
        });
    }, [
        stateSlice.currentPhase,
        stateSlice.step,
        stateSlice.cards.length,
        stateSlice.progress,
        stateSlice.progress.current,
        stateSlice.progress.total,
        stateSlice.conceptProgress,
        stateSlice.conceptProgress.current,
        stateSlice.conceptProgress.total,
        stateSlice.setupStepsCompleted
        // eslint-disable-next-line react-hooks/exhaustive-deps
    ]);

    return useMemo(() => ({
        // State
        state: {
            session: {
                step: stateSlice.step,
                currentPhase: stateSlice.currentPhase,
                isCancelling: stateSlice.isCancelling,
                isHistorical: stateSlice.isHistorical,
                sessionId: stateSlice.sessionId,
                totalPages: stateSlice.totalPages,
                coverageData: stateSlice.coverageData,
                isError: stateSlice.isError,
            },
            logs: {
                logs: stateSlice.logs,
                copied: stateSlice.copied,
            },
            progress: {
                progress: stateSlice.progress,
                conceptProgress: stateSlice.conceptProgress,
                setupStepsCompleted: stateSlice.setupStepsCompleted,
                progressPct,
            },
            cards: {
                cards: stateSlice.cards,
                editingIndex: stateSlice.editingIndex,
                editForm: stateSlice.editForm,
            },
            sync: {
                isSyncing: stateSlice.isSyncing,
                syncSuccess: stateSlice.syncSuccess,
                syncPartialFailure: stateSlice.syncPartialFailure,
                syncProgress: stateSlice.syncProgress,
                syncLogs: stateSlice.syncLogs,
            },
            ui: {
                sortBy: stateSlice.sortBy,
                searchQuery: stateSlice.searchQuery,
                isMultiSelectMode: stateSlice.isMultiSelectMode,
                selectedCards: stateSlice.selectedCards,
                confirmModal: stateSlice.confirmModal,
            }
        },
        // Actions
        actions,
    }), [stateSlice, actions, progressPct]);
}
