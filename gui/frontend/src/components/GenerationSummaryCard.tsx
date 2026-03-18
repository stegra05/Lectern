import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, AlertTriangle, ChevronDown, ChevronUp, Play, X, Calculator, FileSearch, Upload } from 'lucide-react';
import { clsx } from 'clsx';
import { GlassCard } from './GlassCard';
import { DeckSelector, type DeckSelectorProps } from './DeckSelector';
import type { LucideIcon } from 'lucide-react';
import type { RubricSummary } from '../store-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EstimationPhase = 'idle' | 'uploading' | 'analyzing' | 'calculating' | 'done';

export interface CostDisplay {
    total: number;
    inputTokens: number;
    outputTokens: number;
    inputCost: number;
    outputCost: number;
    model: string;
}

export interface SummaryInfo {
    fileName: string | null;
    deckName: string;
    cardCount: number;
    sourceType: string;
}

export interface ValidationState {
    isButtonDisabled: boolean;
    disabledReason: string;
    showCostWarning: boolean;
    attemptedSubmit: boolean;
}

export interface EstimationDisplay {
    phase: EstimationPhase;
    cost: CostDisplay | null;
    isEstimating: boolean;
}

export interface GenerationSummaryCardProps {
    summary: SummaryInfo;
    rubricSummary?: RubricSummary | null;
    cost: CostDisplay | null;
    estimation: EstimationDisplay;
    validation: ValidationState;
    health: { ankiConnected: boolean };
    deckSelectorProps: Omit<DeckSelectorProps, 'disabled'>;
    onGenerate: () => void;
    onDismissCostWarning: () => void;
    onConfirmCostWarning: () => void;
    onAttemptedSubmit: () => void;
}

// ---------------------------------------------------------------------------
// Phase configuration
// ---------------------------------------------------------------------------

const PHASE_CONFIG: Record<EstimationPhase, { label: string; icon: LucideIcon }> = {
    idle: { label: '', icon: Upload },
    uploading: { label: 'Uploading PDF...', icon: Upload },
    analyzing: { label: 'Analyzing document...', icon: FileSearch },
    calculating: { label: 'Calculating costs...', icon: Calculator },
    done: { label: '', icon: Upload },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GenerationSummaryCard({
    summary,
    rubricSummary,
    cost,
    estimation,
    validation,
    health,
    deckSelectorProps,
    onGenerate,
    onDismissCostWarning,
    onConfirmCostWarning,
    onAttemptedSubmit,
}: GenerationSummaryCardProps) {
    const { phase, isEstimating } = estimation;
    const { isButtonDisabled, disabledReason, showCostWarning, attemptedSubmit } = validation;

    const handleGenerateClick = () => {
        if (isButtonDisabled) {
            onAttemptedSubmit();
            return;
        }
        if (showCostWarning) {
            return; // Warning will be shown, don't generate yet
        }
        onGenerate();
    };

    const PhaseIcon = PHASE_CONFIG[phase].icon;

    return (
        <div className="sticky top-24 space-y-6">
            <GlassCard className="relative overflow-hidden group border-primary/10">
                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />

                <h3 className="text-2xl font-bold mb-4 text-text-main">Generation Summary</h3>

                {/* Target Deck Selector */}
                <div className="mb-6">
                    <label className="block text-sm font-medium text-text-muted mb-2 uppercase tracking-wider">
                        Target Deck
                        {attemptedSubmit && !summary.deckName && (
                            <span className="ml-2 text-red-400 text-xs">Required</span>
                        )}
                    </label>
                    <div className={clsx(
                        "relative rounded-xl transition-all",
                        attemptedSubmit && !summary.deckName && "ring-2 ring-red-500/50"
                    )}>
                        <DeckSelector
                            {...deckSelectorProps}
                            disabled={isButtonDisabled && !summary.fileName}
                        />
                        {attemptedSubmit && !summary.deckName && (
                            <div className="absolute -bottom-5 left-0 text-xs text-red-400 flex items-center gap-1">
                                <AlertCircle className="w-3 h-3" />
                                <span>Select a deck to continue</span>
                            </div>
                        )}
                    </div>
                </div>

                <div className="space-y-4 mb-8">
                    <SummaryRow
                        label="Source"
                        value={summary.fileName || 'No file selected'}
                        isActive={!!summary.fileName}
                    />
                    <SummaryRow
                        label="Deck"
                        value={summary.deckName || 'No deck selected'}
                        isActive={!!summary.deckName}
                    />
                    <SummaryRow
                        label="Settings"
                        value={`${summary.sourceType} • ${summary.cardCount} cards`}
                        isActive={true}
                    />
                </div>

                {rubricSummary && (
                    <div className="mb-6 rounded-xl border border-border/50 bg-surface/30 p-4">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Rubric Quality</p>
                        <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                            <div>
                                <p className="text-text-muted">Avg</p>
                                <p className="font-semibold text-text-main">{rubricSummary.avg_quality.toFixed(1)}</p>
                            </div>
                            <div>
                                <p className="text-text-muted">Min</p>
                                <p className="font-semibold text-text-main">{rubricSummary.min_quality.toFixed(1)}</p>
                            </div>
                            <div>
                                <p className="text-text-muted">Max</p>
                                <p className="font-semibold text-text-main">{rubricSummary.max_quality.toFixed(1)}</p>
                            </div>
                        </div>
                        <p className="mt-2 text-[11px] text-text-muted">
                            {rubricSummary.below_threshold_count} of {rubricSummary.total_cards} cards below threshold {rubricSummary.threshold.toFixed(1)}.
                        </p>
                    </div>
                )}

                {(cost || isEstimating) && (
                    <CostSection
                        cost={cost}
                        isEstimating={isEstimating}
                        phase={phase}
                        PhaseIcon={PhaseIcon}
                    />
                )}

                {/* Cost Warning Modal/Banner */}
                <AnimatePresence>
                    {showCostWarning && cost && (
                        <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="overflow-hidden"
                        >
                            <div className="mb-4 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
                                <div className="flex items-start gap-3">
                                    <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
                                    <div className="flex-1">
                                        <p className="text-sm font-semibold text-amber-300">High Cost Operation</p>
                                        <p className="text-xs text-amber-200/80 mt-1">
                                            This operation may cost approximately <span className="font-bold">${cost.total.toFixed(3)}</span>. Proceed?
                                        </p>
                                        <div className="flex gap-2 mt-3">
                                            <button
                                                onClick={onConfirmCostWarning}
                                                className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 rounded-lg text-xs font-medium transition-colors border border-amber-500/30"
                                            >
                                                Proceed
                                            </button>
                                            <button
                                                onClick={onDismissCostWarning}
                                                className="px-3 py-1.5 bg-surface/50 hover:bg-surface text-text-muted rounded-lg text-xs font-medium transition-colors border border-border/50"
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                    <button
                                        onClick={onDismissCostWarning}
                                        className="p-1 hover:bg-amber-500/20 rounded-lg transition-colors"
                                        aria-label="Dismiss warning"
                                    >
                                        <X className="w-4 h-4 text-amber-400" />
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                <div className="relative">
                    <button
                        onClick={handleGenerateClick}
                        disabled={isButtonDisabled}
                        title={isButtonDisabled ? disabledReason : undefined}
                        className="w-full relative group px-8 py-5 bg-primary hover:bg-primary/90 text-background rounded-xl font-bold text-lg shadow-lg shadow-primary/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none overflow-hidden"
                    >
                        <span className="relative z-10 flex items-center justify-center gap-3">
                            <Play className="w-5 h-5 fill-current" />
                            Start Generation
                        </span>
                    </button>
                    <AnimatePresence>
                        {isButtonDisabled && attemptedSubmit && (
                            <motion.div
                                initial={{ opacity: 0, y: 5 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 5 }}
                                className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-xs text-red-400 whitespace-nowrap flex items-center gap-1"
                            >
                                <AlertCircle className="w-3 h-3" />
                                {disabledReason}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {!health.ankiConnected && (
                    <div className="mt-6 flex items-center gap-2 text-text-muted text-xs bg-surface/50 p-3 rounded-lg border border-border/50">
                        <AlertCircle className="w-4 h-4 text-text-muted" />
                        <span>Anki disconnected. Cards will be saved as drafts for later export.</span>
                    </div>
                )}
            </GlassCard>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryRow({ label, value, isActive }: { label: string; value: string; isActive: boolean }) {
    return (
        <div className="flex items-center gap-3 text-sm">
            <div className={clsx(
                "w-2 h-2 rounded-full",
                isActive ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" : "bg-red-500"
            )} />
            <span className="text-text-muted">{label}:</span>
            <span className="font-medium truncate flex-1">{value}</span>
        </div>
    );
}

interface CostSectionProps {
    cost: CostDisplay | null;
    isEstimating: boolean;
    phase: EstimationPhase;
    PhaseIcon: LucideIcon;
}

function CostSection({ cost, isEstimating, phase, PhaseIcon }: CostSectionProps) {
    const [showDetailedCost, setShowDetailedCost] = useState(false);

    return (
        <div className="mb-8 space-y-3">
            <div className="p-4 rounded-xl bg-surface/30 border border-border/50">
                <button
                    onClick={() => setShowDetailedCost(!showDetailedCost)}
                    className="w-full flex items-center justify-between mb-3 border-b border-border/30 pb-2 group/cost"
                >
                    <div className="flex flex-col text-left">
                        <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider group-hover/cost:text-text-main transition-colors">Estimated Cost</span>
                        {isEstimating ? (
                            <div className="h-5 w-16 bg-surface animate-pulse rounded mt-1" />
                        ) : (
                            <span className="text-lg font-medium text-text-main">${cost?.total.toFixed(3)}</span>
                        )}
                    </div>
                    <div className="flex flex-col items-end">
                        {!isEstimating && cost && (
                            <div className="text-right mb-1">
                                <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider block">Model</span>
                                <span className="text-xs font-mono text-text-main">{cost.model.split('/').pop()}</span>
                            </div>
                        )}
                        <div className="text-text-muted group-hover/cost:text-primary transition-colors">
                            {showDetailedCost ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </div>
                    </div>
                </button>

                <AnimatePresence>
                    {showDetailedCost && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                        >
                            <div className="grid grid-cols-2 gap-4 pt-1">
                                <div className="space-y-1">
                                    <span className="text-[9px] font-bold text-text-muted uppercase">Input</span>
                                    <div className="flex items-baseline gap-1">
                                        {isEstimating ? (
                                            <div className="h-4 w-12 bg-surface animate-pulse rounded" />
                                        ) : (
                                            <>
                                                <span className="text-sm font-semibold text-text-main">
                                                    {((cost?.inputTokens ?? 0) / 1000).toFixed(1)}k
                                                </span>
                                                <span className="text-[9px] text-text-muted">tokens</span>
                                            </>
                                        )}
                                    </div>
                                    {!isEstimating && cost && (
                                        <div className="text-[10px] text-text-muted font-mono">${cost.inputCost.toFixed(4)}</div>
                                    )}
                                </div>
                                <div className="space-y-1">
                                    <span className="text-[9px] font-bold text-text-muted uppercase">Output (Est.)</span>
                                    <div className="flex items-baseline gap-1">
                                        {isEstimating ? (
                                            <div className="h-4 w-12 bg-surface animate-pulse rounded" />
                                        ) : (
                                            <>
                                                <span className="text-sm font-semibold text-text-main">
                                                    {((cost?.outputTokens ?? 0) / 1000).toFixed(1)}k
                                                </span>
                                                <span className="text-[9px] text-text-muted">tokens</span>
                                            </>
                                        )}
                                    </div>
                                    {!isEstimating && cost && (
                                        <div className="text-[10px] text-text-muted font-mono">${cost.outputCost.toFixed(4)}</div>
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
            {isEstimating && phase !== 'idle' && (
                <div className="flex items-center justify-center gap-2 py-2 text-xs text-primary">
                    <motion.div
                        initial={{ opacity: 0.5 }}
                        animate={{ opacity: [0.5, 1, 0.5] }}
                        transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                        className="flex items-center gap-2"
                    >
                        <PhaseIcon className="w-3 h-3" />
                        <span>{PHASE_CONFIG[phase].label}</span>
                    </motion.div>
                </div>
            )}
        </div>
    );
}
