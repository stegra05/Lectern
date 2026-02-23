import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, AlertTriangle, ChevronDown, ChevronUp, Play, X, Calculator, FileSearch, Upload } from 'lucide-react';
import { clsx } from 'clsx';
import { GlassCard } from './GlassCard';
import { DeckSelector } from './DeckSelector';
import { useLecternStore } from '../store';
import { useEstimationPhase, type EstimationPhase } from '../hooks/useEstimationPhase';
import type { HealthStatus } from '../hooks/useAppState';
import type { LucideIcon } from 'lucide-react';

const COST_WARNING_THRESHOLD = 0.50;

const PHASE_CONFIG: Record<EstimationPhase, { label: string; icon: LucideIcon }> = {
    idle: { label: '', icon: Upload },
    uploading: { label: 'Uploading PDF...', icon: Upload },
    analyzing: { label: 'Analyzing document...', icon: FileSearch },
    calculating: { label: 'Calculating costs...', icon: Calculator },
    done: { label: '', icon: Upload },
};

interface GenerationSummaryCardProps {
    handleGenerate: () => void;
    health: HealthStatus | null;
}

export function GenerationSummaryCard({ handleGenerate, health }: GenerationSummaryCardProps) {
    const deckName = useLecternStore((s) => s.deckName);
    const setDeckName = useLecternStore((s) => s.setDeckName);
    const pdfFile = useLecternStore((s) => s.pdfFile);
    const sourceType = useLecternStore((s) => s.sourceType);
    const targetDeckSize = useLecternStore((s) => s.targetDeckSize);
    const estimation = useLecternStore((s) => s.estimation);
    const isEstimating = useLecternStore((s) => s.isEstimating);
    const budgetLimit = useLecternStore((s) => s.budgetLimit);
    const totalSessionSpend = useLecternStore((s) => s.totalSessionSpend);
    const wouldExceedBudget = useLecternStore((s) => s.wouldExceedBudget);

    const estimationPhase = useEstimationPhase(isEstimating);

    const [attemptedSubmit, setAttemptedSubmit] = useState(false);
    const [showCostWarning, setShowCostWarning] = useState(false);
    const [costWarningDismissed, setCostWarningDismissed] = useState(false);
    const [showDetailedCost, setShowDetailedCost] = useState(false);

    // Reset warning dismissal when estimation changes
    useEffect(() => {
        if (costWarningDismissed) {
            setCostWarningDismissed(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [estimation]);

    const estimatedCost = estimation?.cost ?? 0;
    const shouldShowCostWarning = !isEstimating && estimatedCost > COST_WARNING_THRESHOLD && !costWarningDismissed;
    const wouldHitBudget = wouldExceedBudget(estimatedCost);
    const isBudgetExceeded = budgetLimit !== null && wouldHitBudget;

    // The logic to determine if slider is disabled is slightly duplicated here 
    // but it's simpler than storing it just for this check.
    const sliderDisabled = isEstimating || (estimation?.suggested_card_count === undefined);

    const isButtonDisabled = !pdfFile || !deckName || isEstimating || sliderDisabled || isBudgetExceeded;

    const getDisabledReason = () => {
        if (!pdfFile) return 'Upload a PDF first';
        if (!deckName) return 'Select a target deck above';
        if (isBudgetExceeded) return 'Budget limit reached';
        if (isEstimating) return 'Calculating cost estimate...';
        if (sliderDisabled) return 'Estimation in progress...';
        return '';
    };
    const disabledReason = isButtonDisabled ? getDisabledReason() : '';

    const handleGenerateClick = () => {
        if (isButtonDisabled) {
            setAttemptedSubmit(true);
            return;
        }
        if (shouldShowCostWarning) {
            setShowCostWarning(true);
            return;
        }
        if (isBudgetExceeded) {
            return;
        }
        handleGenerate();
    };

    const handleProceedWithCost = () => {
        setShowCostWarning(false);
        setCostWarningDismissed(true);
        handleGenerate();
    };

    const handleDismissWarning = () => {
        setShowCostWarning(false);
        setCostWarningDismissed(true);
    };

    return (
        <div className="sticky top-24 space-y-6">
            <GlassCard className="relative overflow-hidden group border-primary/10">
                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />

                <h3 className="text-2xl font-bold mb-4 text-text-main">Generation Summary</h3>

                {/* Target Deck Selector */}
                <div className="mb-6">
                    <label className="block text-sm font-medium text-text-muted mb-2 uppercase tracking-wider">
                        Target Deck
                        {attemptedSubmit && !deckName && (
                            <span className="ml-2 text-red-400 text-xs">Required</span>
                        )}
                    </label>
                    <div className={clsx(
                        "relative rounded-xl transition-all",
                        attemptedSubmit && !deckName && "ring-2 ring-red-500/50"
                    )}>
                        <DeckSelector
                            value={deckName}
                            onChange={setDeckName}
                            disabled={!health?.anki_connected}
                        />
                        {attemptedSubmit && !deckName && (
                            <div className="absolute -bottom-5 left-0 text-xs text-red-400 flex items-center gap-1">
                                <AlertCircle className="w-3 h-3" />
                                <span>Select a deck to continue</span>
                            </div>
                        )}
                    </div>
                </div>

                <div className="space-y-4 mb-8">
                    <div className="flex items-center gap-3 text-sm">
                        <div className={clsx("w-2 h-2 rounded-full", pdfFile ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" : "bg-red-500")} />
                        <span className="text-text-muted">Source:</span>
                        <span className="font-medium truncate flex-1">{pdfFile?.name || 'No file selected'}</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                        <div className={clsx("w-2 h-2 rounded-full", deckName ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" : "bg-red-500")} />
                        <span className="text-text-muted">Deck:</span>
                        <span className="font-medium truncate flex-1">{deckName || 'No deck selected'}</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                        <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
                        <span className="text-text-muted">Settings:</span>
                        <span className="font-medium capitalize">{sourceType} • {targetDeckSize} cards</span>
                    </div>
                </div>

                {(estimation || isEstimating) && (
                    <div className="mb-8 space-y-3">
                        <div className="p-4 rounded-xl bg-surface/30 border border-border/50">
                            <button
                                onClick={() => setShowDetailedCost(!showDetailedCost)}
                                className="w-full flex items-center justify-between mb-3 border-b border-border/30 pb-2 group/cost"
                            >
                                <div className="flex flex-col text-left">
                                    <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider group-hover/cost:text-primary transition-colors">Estimated Cost</span>
                                    {isEstimating ? (
                                        <div className="h-7 w-20 bg-surface animate-pulse rounded mt-1" />
                                    ) : (
                                        <span className="text-2xl font-bold text-primary">${estimation?.cost.toFixed(3)}</span>
                                    )}
                                </div>
                                <div className="flex flex-col items-end">
                                    {!isEstimating && (
                                        <div className="text-right mb-1">
                                            <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider block">Model</span>
                                            <span className="text-xs font-mono text-text-main">{estimation?.model.split('/').pop()}</span>
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
                                                                {((estimation?.input_tokens ?? 0) / 1000).toFixed(1)}k
                                                            </span>
                                                            <span className="text-[9px] text-text-muted">tokens</span>
                                                        </>
                                                    )}
                                                </div>
                                                {!isEstimating && (
                                                    <div className="text-[10px] text-text-muted font-mono">${estimation?.input_cost.toFixed(4)}</div>
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
                                                                {((estimation?.output_tokens ?? 0) / 1000).toFixed(1)}k
                                                            </span>
                                                            <span className="text-[9px] text-text-muted">tokens</span>
                                                        </>
                                                    )}
                                                </div>
                                                {!isEstimating && (
                                                    <div className="text-[10px] text-text-muted font-mono">${estimation?.output_cost.toFixed(4)}</div>
                                                )}
                                            </div>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                        {isEstimating && estimationPhase !== 'idle' && (
                            <div className="flex items-center justify-center gap-2 py-2 text-xs text-primary">
                                <motion.div
                                    initial={{ opacity: 0.5 }}
                                    animate={{ opacity: [0.5, 1, 0.5] }}
                                    transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                                    className="flex items-center gap-2"
                                >
                                    {estimationPhase === 'uploading' && <Upload className="w-3 h-3" />}
                                    {estimationPhase === 'analyzing' && <FileSearch className="w-3 h-3" />}
                                    {estimationPhase === 'calculating' && <Calculator className="w-3 h-3" />}
                                    <span>{PHASE_CONFIG[estimationPhase].label}</span>
                                </motion.div>
                            </div>
                        )}
                    </div>
                )}

                {/* Budget Limit Exceeded Warning */}
                <AnimatePresence>
                    {isBudgetExceeded && (
                        <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="overflow-hidden"
                        >
                            <div className="mb-4 p-4 rounded-xl bg-red-500/10 border border-red-500/20">
                                <div className="flex items-start gap-3">
                                    <AlertCircle className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />
                                    <div className="flex-1">
                                        <p className="text-sm font-semibold text-red-300">Budget Limit Reached</p>
                                        <p className="text-xs text-red-200/80 mt-1">
                                            You've spent ${totalSessionSpend.toFixed(2)} of your ${budgetLimit!.toFixed(2)} limit.
                                        </p>
                                        <p className="text-xs text-red-200/60 mt-1">
                                            This operation would cost ${estimatedCost.toFixed(3)}. Reset your session spend or increase your budget to continue.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Cost Warning Modal/Banner */}
                <AnimatePresence>
                    {showCostWarning && (
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
                                            This operation may cost approximately <span className="font-bold">${estimatedCost.toFixed(3)}</span>. Proceed?
                                        </p>
                                        <div className="flex gap-2 mt-3">
                                            <button
                                                onClick={handleProceedWithCost}
                                                className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 rounded-lg text-xs font-medium transition-colors border border-amber-500/30"
                                            >
                                                Proceed
                                            </button>
                                            <button
                                                onClick={handleDismissWarning}
                                                className="px-3 py-1.5 bg-surface/50 hover:bg-surface text-text-muted rounded-lg text-xs font-medium transition-colors border border-border/50"
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                    <button
                                        onClick={handleDismissWarning}
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

                {!health?.anki_connected && (
                    <div className="mt-6 flex items-center gap-2 text-text-muted text-xs bg-surface/50 p-3 rounded-lg border border-border/50">
                        <AlertCircle className="w-4 h-4 text-text-muted" />
                        <span>Anki disconnected. Cards will be saved as drafts for later export.</span>
                    </div>
                )}
            </GlassCard>
        </div>
    );
}
