/**
 * Control-plane snapshot handler.
 *
 * Applies a ControlSnapshot to the store. The snapshot ONLY updates
 * phase / progress metadata — it never touches the cards array.
 * Cards arrive on the data plane via individual 'card' events.
 */

import type { ControlSnapshot, CoverageData } from '../api';
import type { StoreState } from '../store-types';
import type { Phase } from '../components/PhaseIndicator';

/** Map SnapshotStatus → UI Phase (used by PhaseIndicator). */
export function mapStatusToPhase(status: ControlSnapshot['status']): Phase {
    switch (status) {
        case 'concept':    return 'concept';
        case 'generating': return 'generating';
        case 'reflecting': return 'reflecting';
        case 'exporting':  return 'exporting';
        case 'complete':   return 'complete';
        case 'error':      return 'complete'; // error is surfaced via isError, not phase
        case 'cancelled':  return 'complete';
        case 'idle':
        default:           return 'idle';
    }
}

/**
 * Pure function: given a snapshot and any fields that must be preserved
 * (e.g., cards, persisted prefs), returns the Partial<StoreState> to apply.
 *
 * CRITICAL: cards are never included here. The data plane handles them.
 */
export function applyControlSnapshot(
    snapshot: ControlSnapshot,
): Partial<StoreState> {
    const currentPhase = mapStatusToPhase(snapshot.status);

    return {
        sessionId: snapshot.session_id,
        currentPhase,
        progress: snapshot.progress,
        conceptProgress: snapshot.concept_progress,
        ...(snapshot.total_pages > 0 && { totalPages: snapshot.total_pages }),
        coverageData: snapshot.coverage_data as CoverageData | null,
        isError: snapshot.is_error,
        lastSnapshotTimestamp: snapshot.timestamp,
        // DESIGN(Fix 4): Snapshots are the "Checkpoints of Truth". Individual 'progress_update' 
        // events provide real-time granularity (trickle), but snapshots reset the bar to 
        // the authoritative backend state. This race is acceptable as the view model 
        // handles smooth transitions.
    };
}
