import { createSelector } from 'reselect';
import type { StoreState } from './store-types';
import { filterCards, sortCards } from './utils/cards';
import { countCardsByType } from './logic/progress';
import { calculateProgressPercentage } from './logic/progress';

export const selectCards = (state: StoreState) => state.cards;
export const selectSearchQuery = (state: StoreState) => state.searchQuery;
export const selectSortBy = (state: StoreState) => state.sortBy;
export const selectPdfFile = (state: StoreState) => state.pdfFile;
export const selectDeckName = (state: StoreState) => state.deckName;
export const selectTargetDeckSize = (state: StoreState) => state.targetDeckSize;
export const selectEstimation = (state: StoreState) => state.estimation;
export const selectIsEstimating = (state: StoreState) => state.isEstimating;
export const selectEstimationError = (state: StoreState) => state.estimationError;
export const selectStep = (state: StoreState) => state.step;
export const selectCurrentPhase = (state: StoreState) => state.currentPhase;
export const selectProgress = (state: StoreState) => state.progress;
export const selectConceptProgress = (state: StoreState) => state.conceptProgress;
export const selectSetupStepsCompleted = (state: StoreState) => state.setupStepsCompleted;
export const selectIsSyncing = (state: StoreState) => state.isSyncing;
export const selectSyncSuccess = (state: StoreState) => state.syncSuccess;
export const selectSyncPartialFailure = (state: StoreState) => state.syncPartialFailure;
export const selectSyncProgress = (state: StoreState) => state.syncProgress;
export const selectSyncLogs = (state: StoreState) => state.syncLogs;
export const selectIsMultiSelectMode = (state: StoreState) => state.isMultiSelectMode;
export const selectSelectedCards = (state: StoreState) => state.selectedCards;

export const selectFilteredCards = createSelector(
  [selectCards, selectSearchQuery],
  (cards, query) => filterCards(cards, query)
);

export const selectSortedCards = createSelector(
  [selectFilteredCards, selectSortBy],
  (filtered, sortBy) => sortCards(filtered, sortBy)
);

export const selectUidToIndex = createSelector(
  [selectCards],
  (cards) => {
    const map = new Map<string, number>();
    cards.forEach((c, i) => { if (c._uid) map.set(c._uid, i); });
    return map;
  }
);

export const selectTypeCounts = createSelector(
  [selectCards],
  (cards) => countCardsByType(cards)
);

export const selectProgressPct = createSelector(
  [selectStep, selectCurrentPhase, selectCards, selectProgress, selectConceptProgress, selectSetupStepsCompleted],
  (step, currentPhase, cards, progress, conceptProgress, setupStepsCompleted) => {
    if (step !== 'generating' && step !== 'done') return 0;
    return calculateProgressPercentage({
      currentPhase,
      step: step as 'generating' | 'done',
      cardsLength: cards.length,
      progressTotal: progress.total,
      progressCurrent: progress.current,
      conceptProgress,
      setupStepsCompleted,
    });
  }
);

export const selectCostDisplay = createSelector(
  [selectEstimation],
  (est) => {
    if (!est) return null;
    return {
      total: est.cost,
      inputTokens: est.input_tokens,
      outputTokens: est.output_tokens,
      inputCost: est.input_cost,
      outputCost: est.output_cost,
      model: est.model,
    };
  }
);

export const selectSummaryInfo = createSelector(
  [selectPdfFile, selectDeckName, selectTargetDeckSize, selectEstimation],
  (pdfFile, deckName, targetDeckSize, estimation) => ({
    fileName: pdfFile?.name ?? null,
    deckName,
    cardCount: targetDeckSize,
    sourceType: (estimation?.document_type as 'slides' | 'script' | 'auto') ?? 'auto',
  })
);

export const selectHasUnsyncedCards = createSelector(
  [selectCards, selectSyncSuccess],
  (cards, syncSuccess) => cards.length > 0 && !syncSuccess
);
