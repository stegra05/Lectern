import { memo } from 'react';
import type { Phase } from './PhaseIndicator';

interface ProgressFooterProps {
    currentPhase: Phase;
    conceptProgress: { current: number; total: number };
    progress: { current: number; total: number };
    cardsLength: number;
    progressDisplay: number;
    timeEstimate: {
        formatted: string | null;
        confidence: 'low' | 'medium' | 'high';
    };
}

/**
 * Progress footer component for showing generation progress.
 * Memoized to prevent re-renders when unrelated state changes.
 */
export const ProgressFooter = memo(function ProgressFooter({
    currentPhase,
    conceptProgress,
    progress,
    cardsLength,
    progressDisplay,
    timeEstimate,
}: ProgressFooterProps) {
    return (
        <div className="p-5 border-t border-border bg-surface/30">
            <div className="flex justify-between items-end mb-2">
                <div>
                    <h3 className="text-xs font-medium text-text-main">Progress</h3>
                    <div className="text-[10px] text-text-muted mt-0.5 font-mono">
                        <span className="flex items-center gap-1.5 group relative">
                            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                            {/* Phase-specific text */}
                            {currentPhase === 'concept' && (
                                conceptProgress.total > 0 ? (
                                    <span>Slide {conceptProgress.current}/{conceptProgress.total}</span>
                                ) : (
                                    <span>Analyzing slides...</span>
                                )
                            )}
                            {currentPhase === 'generating' && (
                                progress.total > 0
                                    ? <span>{cardsLength}/{progress.total} cards</span>
                                    : <span>{cardsLength} cards</span>
                            )}
                            {currentPhase === 'reflecting' && <span>Reviewing...</span>}
                            {currentPhase === 'complete' && <span className="text-primary">Done - {cardsLength} cards</span>}
                            {(!currentPhase || currentPhase === 'idle') && <span>Starting...</span>}

                            {/* Tooltip with time estimate */}
                            <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute bottom-full left-0 mb-2 px-3 py-2 bg-zinc-800 text-zinc-200 text-xs rounded-lg whitespace-nowrap pointer-events-none border border-zinc-700 shadow-xl z-50">
                                {timeEstimate.formatted || 'Calculating...'}
                            </div>
                        </span>
                    </div>
                </div>
                <span
                    className="text-xl font-bold cursor-default text-primary"
                    title={timeEstimate.formatted || undefined}
                >
                    {progressDisplay}%
                </span>
            </div>
            <div className="h-1.5 w-full bg-surface rounded-full overflow-hidden">
                <div
                    className="h-full rounded-full bg-primary shadow-[0_0_10px_rgba(163,230,53,0.5)] transition-all duration-500 ease-out"
                    style={{ width: `${Math.min(100, progressDisplay)}%` }}
                />
            </div>
            {/* Time estimate below progress bar */}
            {timeEstimate.formatted && currentPhase !== 'complete' && currentPhase !== 'idle' && (
                <p className="text-[10px] text-text-muted mt-1.5">
                    {timeEstimate.formatted}
                    {timeEstimate.confidence === 'low' && ' (estimating...)'}
                </p>
            )}
        </div>
    );
});
