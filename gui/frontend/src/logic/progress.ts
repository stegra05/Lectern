/**
 * Progress calculation utilities for generation phases.
 *
 * These are pure functions extracted from ProgressView to enable:
 * - Unit testing without React component overhead
 * - Reusability across components
 * - Clear separation of calculation logic from UI
 */

import type { Phase } from '../components/PhaseIndicator';

/** Weights for each phase in the overall progress calculation */
export const PROGRESS_WEIGHTS = {
    concept: 0.10,
    generating: 0.85,
    reflecting: 0.05,
} as const;

/** Input for progress percentage calculation */
export interface ProgressInput {
    /** Current generation phase */
    currentPhase: Phase | null;
    /** Current step in the session flow */
    step: 'generating' | 'done';
    /** Number of cards generated so far */
    cardsLength: number;
    /** Total cards expected (batch-based progress) */
    progressTotal: number;
    /** Current batch progress */
    progressCurrent: number;
    /** Concept mapping progress */
    conceptProgress: { current: number; total: number };
    /** Number of setup steps completed (pre-generation) */
    setupStepsCompleted: number;
}

/**
 * Count cards by their model type (basic vs cloze).
 *
 * @param cards - Array of card objects with optional model_name
 * @returns Object with basic and cloze counts
 */
export function countCardsByType(cards: { model_name?: string }[]): { basic: number; cloze: number } {
    let basic = 0;
    let cloze = 0;

    for (const card of cards) {
        if ((card.model_name || '').toLowerCase().includes('cloze')) {
            cloze++;
        } else {
            basic++;
        }
    }

    return { basic, cloze };
}

/**
 * Calculate the overall progress percentage based on current phase and metrics.
 *
 * Progress is weighted by phase:
 * - Concept phase: 0-10% (weight: 0.10)
 * - Generating phase: 10-95% (weight: 0.85)
 * - Reflecting phase: 95-100% (weight: 0.05)
 *
 * @param input - Progress calculation input parameters
 * @returns Progress percentage (1-100)
 */
export function calculateProgressPercentage(input: ProgressInput): number {
    const {
        currentPhase,
        step,
        cardsLength,
        progressTotal,
        progressCurrent,
        conceptProgress,
        setupStepsCompleted,
    } = input;

    // Complete state
    if (currentPhase === 'complete' || step === 'done') {
        return 100;
    }

    const { concept, generating, reflecting } = PROGRESS_WEIGHTS;

    // Calculate phase-specific percentages
    const conceptPct = conceptProgress.total > 0
        ? conceptProgress.current / conceptProgress.total
        : 0;

    // For generating phase, use the max of card-based or batch-based progress
    const cardBased = progressTotal > 0 ? cardsLength / progressTotal : 0;
    const batchBased = progressTotal > 0 ? progressCurrent / progressTotal : 0;
    const generatingPct = Math.min(1, Math.max(cardBased, batchBased));

    // Reflecting phase progress
    const reflectPct = progressTotal > 0 ? progressCurrent / progressTotal : 0;

    // Calculate weighted progress based on current phase
    if (currentPhase === 'concept') {
        return Math.max(1, Math.round(conceptPct * concept * 100));
    }

    if (currentPhase === 'generating') {
        return Math.round((concept + generatingPct * generating) * 100);
    }

    if (currentPhase === 'reflecting') {
        return Math.round((concept + generating + reflectPct * reflecting) * 100);
    }

    // Exporting phase is handled during sync (not generation progress)
    if (currentPhase === 'exporting') {
        return 100; // Sync has its own progress indicator
    }

    // Idle phase means we haven't started yet
    if (currentPhase === 'idle') {
        return 0;
    }

    // Pre-generation setup steps (each step contributes ~2%)
    if (setupStepsCompleted > 0) {
        return Math.max(1, Math.round(setupStepsCompleted * 2));
    }

    // Default starting point
    return 1;
}
