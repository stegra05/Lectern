import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, AlertCircle, Sparkles, Monitor, FileText, Info, Upload, FileSearch, Calculator, AlertTriangle, X, ChevronDown, ChevronUp, Lock } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';
import { GlassCard } from '../components/GlassCard';
import { FilePicker } from '../components/FilePicker';
import { DeckSelector } from '../components/DeckSelector';
import { computeCardsPerUnit, computeTargetSliderConfig } from '../utils/density';
import { type FriendlyError, translateError } from '../utils/errorMessages';

import type { HealthStatus } from '../hooks/useAppState';
import type { Estimation } from '../api';

const COST_WARNING_THRESHOLD = 0.50;

type EstimationPhase = 'idle' | 'uploading' | 'analyzing' | 'calculating' | 'done';

const PHASE_CONFIG: Record<EstimationPhase, { label: string; icon: LucideIcon }> = {
    idle: { label: '', icon: Upload },
    uploading: { label: 'Uploading PDF...', icon: Upload },
    analyzing: { label: 'Analyzing document...', icon: FileSearch },
    calculating: { label: 'Calculating costs...', icon: Calculator },
    done: { label: '', icon: Upload },
};

interface HomeViewProps {
    pdfFile: File | null;
    setPdfFile: (file: File | null) => void;
    deckName: string;
    setDeckName: (name: string) => void;
    focusPrompt: string;
    setFocusPrompt: (prompt: string) => void;
    sourceType: 'auto' | 'slides' | 'script';
    setSourceType: (type: 'auto' | 'slides' | 'script') => void;
    targetDeckSize: number;
    setTargetDeckSize: (target: number) => void;
    estimation: Estimation | null;
    isEstimating: boolean;
    estimationError: string | null;
    handleGenerate: () => void;
    health: HealthStatus | null;
    // Budget tracking props
    totalSessionSpend: number;
    budgetLimit: number | null;
    wouldExceedBudget: (amount: number) => boolean;
}

export function HomeView({
    pdfFile,
    setPdfFile,
    deckName,
    setDeckName,
    focusPrompt,
    setFocusPrompt,
    sourceType,
    setSourceType,
    targetDeckSize,
    setTargetDeckSize,
    estimation,
    isEstimating,
    estimationError,
    handleGenerate,
    health,
    totalSessionSpend,
    budgetLimit,
    wouldExceedBudget,
}: HomeViewProps) {
    // Estimation phase state for sub-status feedback
    const [estimationPhase, setEstimationPhase] = useState<EstimationPhase>('idle');

    // Reset phase when estimation stops
    const [prevIsEstimating, setPrevIsEstimating] = useState(isEstimating);
    if (isEstimating !== prevIsEstimating) {
        setPrevIsEstimating(isEstimating);
        if (!isEstimating) {
            setEstimationPhase('idle');
        }
    }

    // Cost warning state
    const [showCostWarning, setShowCostWarning] = useState(false);
    const [costWarningDismissed, setCostWarningDismissed] = useState(false);
    const [showDetailedCost, setShowDetailedCost] = useState(false);

    // Manage estimation phase transitions based on isEstimating
    useEffect(() => {
        if (!isEstimating) return;

        // Immediately show uploading phase (deferred to next tick to avoid ESLint error)
        const uploadTimer = setTimeout(() => {
            setEstimationPhase('uploading');
        }, 0);

        // After 500ms, transition to analyzing
        const analyzeTimer = setTimeout(() => {
            setEstimationPhase('analyzing');
        }, 500);

        // After 2s, show calculating (if still estimating, likely processing response)
        const calculateTimer = setTimeout(() => {
            setEstimationPhase('calculating');
        }, 2000);

        return () => {
            clearTimeout(uploadTimer);
            clearTimeout(analyzeTimer);
            clearTimeout(calculateTimer);
        };
    }, [isEstimating]);

    const containerVariants = {
        hidden: { opacity: 0 },
        show: {
            opacity: 1,
            transition: {
                staggerChildren: 0.1
            }
        }
    };

    const itemVariants = {
        hidden: { opacity: 0, y: 20 },
        show: { opacity: 1, y: 0 }
    };

    const sliderConfig = computeTargetSliderConfig(estimation?.suggested_card_count);

    // Clamp targetDeckSize into slider range whenever the range changes
    const { min: sMin, max: sMax, disabled: sDisabled } = sliderConfig;
    if (!sDisabled && (targetDeckSize < sMin || targetDeckSize > sMax)) {
        const clamped = Math.min(Math.max(targetDeckSize, sMin), sMax);
        // Defer to avoid setting state during render
        queueMicrotask(() => setTargetDeckSize(clamped));
    }

    const cardsPerUnit = computeCardsPerUnit(targetDeckSize, sourceType, estimation);

    // Cost and budget logic
    const estimatedCost = estimation?.cost ?? 0;
    const shouldShowCostWarning = !isEstimating && estimatedCost > COST_WARNING_THRESHOLD && !costWarningDismissed;
    const wouldHitBudget = wouldExceedBudget(estimatedCost);
    const isBudgetExceeded = budgetLimit !== null && wouldHitBudget;

    const handleGenerateClick = () => {
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

    // Reset warning dismissal when estimation changes (new PDF or settings)
    useEffect(() => {
        if (costWarningDismissed) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setCostWarningDismissed(false);
        }
    }, [estimation, costWarningDismissed]);

    // Check if budget would be exceeded for button disable
    const isButtonDisabled = !pdfFile || !deckName || isEstimating || sliderConfig.disabled || isBudgetExceeded;

    return (
        <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="show"
            exit={{ opacity: 0, y: -20 }}
            className="grid grid-cols-1 lg:grid-cols-12 gap-8"
        >
            {/* LEFT COLUMN: Source & Configuration */}
            <motion.div variants={itemVariants} className="lg:col-span-7 space-y-8">
                <GlassCard className="space-y-6">
                    <div className="flex items-center gap-3">
                        <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-surface text-text-muted font-mono text-sm">01</span>
                        <h2 className="text-xl font-semibold">Source Material</h2>
                    </div>
                    <FilePicker file={pdfFile} onFileSelect={setPdfFile} />

                    <div className={clsx("space-y-4 transition-all duration-500", !pdfFile && "opacity-40 grayscale pointer-events-none")}>
                        <label className="block text-xs font-bold text-text-muted uppercase tracking-wider">Document Context</label>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            {[
                                { id: 'auto', label: 'Auto Detect', icon: Sparkles, desc: 'Mixed content' },
                                { id: 'slides', label: 'Slides', icon: Monitor, desc: 'Visual heavy' },
                                { id: 'script', label: 'Script', icon: FileText, desc: 'Text dense' },
                            ].map((type) => (
                                <button
                                    key={type.id}
                                    onClick={() => setSourceType(type.id as 'auto' | 'slides' | 'script')}
                                    className={clsx(
                                        "relative flex flex-col items-start p-4 rounded-xl border transition-all duration-200 text-left",
                                        sourceType === type.id
                                            ? "bg-primary/10 border-primary/40 shadow-sm"
                                            : "bg-surface/30 border-border/50 text-text-muted hover:border-border"
                                    )}
                                >
                                    <div className={clsx(
                                        "p-2 rounded-lg mb-3",
                                        sourceType === type.id ? "bg-primary text-background" : "bg-surface text-text-muted"
                                    )}>
                                        <type.icon className="w-4 h-4" />
                                    </div>
                                    <span className={clsx("font-medium text-sm", sourceType === type.id ? "text-primary" : "text-text-main")}>
                                        {type.label}
                                    </span>
                                    <span className="text-[10px] text-text-muted mt-0.5">{type.desc}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </GlassCard>

                <GlassCard className="space-y-6">
                    <div className="flex items-center gap-3">
                        <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-surface text-text-muted font-mono text-sm">02</span>
                        <h2 className="text-xl font-semibold">Configuration</h2>
                    </div>

                    <div className="space-y-6">
                        <div>
                            <label className="block text-sm font-medium text-text-muted mb-2 uppercase tracking-wider">Target Deck</label>
                            <DeckSelector
                                value={deckName}
                                onChange={setDeckName}
                                disabled={!health?.anki_connected}
                            />
                        </div>

                        <div className="pt-4 border-t border-border/30">
                            <div className="flex justify-between items-end mb-4">
                                <div className="flex items-center gap-2">
                                    <label className="text-sm font-medium text-text-muted uppercase tracking-wider">Total Cards</label>
                                    {sliderConfig.disabled && (
                                        <div className="flex items-center gap-1 text-[10px] text-amber-400/80 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                                            <Lock className="w-3 h-3" />
                                            <span>Limited by length</span>
                                        </div>
                                    )}
                                </div>
                                <div className="text-right">
                                    <span className={clsx("text-xl font-bold", sliderConfig.disabled ? "text-text-muted" : "text-primary")}>
                                        {targetDeckSize}
                                    </span>
                                </div>
                            </div>

                            <div className="flex items-center gap-4">
                                <input
                                    type="range"
                                    min={sliderConfig.min}
                                    max={sliderConfig.max}
                                    step="1"
                                    value={targetDeckSize}
                                    disabled={sliderConfig.disabled}
                                    onChange={(e) => setTargetDeckSize(parseInt(e.target.value, 10))}
                                    className="flex-1 h-1.5 bg-surface rounded-lg appearance-none cursor-pointer accent-primary"
                                />
                            </div>
                            <div className="flex justify-between text-[10px] text-text-muted mt-2 px-1 font-medium">
                                <span>{sliderConfig.disabled ? '' : sliderConfig.min}</span>
                                <div className="flex flex-col items-center">
                                    {isEstimating ? (
                                        <motion.span
                                            className="text-primary font-bold flex items-center gap-1"
                                            initial={{ opacity: 0.5 }}
                                            animate={{ opacity: [0.5, 1, 0.5] }}
                                            transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                                        >
                                            {estimationPhase === 'uploading' && <Upload className="w-2.5 h-2.5" />}
                                            {estimationPhase === 'analyzing' && <FileSearch className="w-2.5 h-2.5" />}
                                            {estimationPhase === 'calculating' && <Calculator className="w-2.5 h-2.5" />}
                                            {(estimationPhase === 'idle' || estimationPhase === 'done') && <Upload className="w-2.5 h-2.5" />}
                                            {PHASE_CONFIG[estimationPhase].label || 'ESTIMATING...'}
                                        </motion.span>
                                    ) : (
                                        <span>{sliderConfig.disabled ? '' : estimation?.suggested_card_count}</span>
                                    )}
                                </div>
                                <span>{sliderConfig.disabled ? '' : sliderConfig.max}</span>
                            </div>

                            {estimationError && !isEstimating && (() => {
                                const friendlyError: FriendlyError = translateError(estimationError, 'estimation');
                                return (
                                    <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                                        <div className="flex items-start gap-2">
                                            <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-red-300">{friendlyError.title}</p>
                                                <p className="text-xs text-red-200/80 mt-0.5">{friendlyError.message}</p>
                                                {friendlyError.action && (
                                                    <p className="text-xs text-primary mt-1">{friendlyError.action}</p>
                                                )}
                                                {friendlyError.errorCode && (
                                                    <p className="text-[10px] text-red-300/50 font-mono mt-2">
                                                        Error: {friendlyError.errorCode}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })()}

                            <div className="mt-4 p-3 rounded-lg bg-surface/30 border border-border/30 flex items-start gap-3">
                                <Info className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                                <div className="text-xs text-text-muted leading-relaxed">
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="font-bold text-primary">
                                            {cardsPerUnit.label}: {cardsPerUnit.value}
                                        </span>
                                        {estimation?.suggested_card_count !== undefined && (
                                            <span className="px-2 py-0.5 rounded bg-primary/20 text-primary text-[10px] font-bold">
                                                SUGGESTED {estimation.suggested_card_count}
                                            </span>
                                        )}
                                    </div>
                                    <span>
                                        {isEstimating
                                            ? 'Analyzing document to determine a recommended card target.'
                                            : sliderConfig.disabled && estimationError
                                                ? 'Could not analyze document. Check your API key.'
                                                : 'Backend derives the density target from this total card goal.'}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="pt-4 border-t border-border/30">
                            <label className="block text-sm font-medium text-text-muted mb-2 uppercase tracking-wider">Focus Guidance (Optional)</label>
                            <textarea
                                value={focusPrompt}
                                onChange={(e) => setFocusPrompt(e.target.value)}
                                placeholder="E.g. 'Focus on clinical formulas' or 'Prioritize case studies'"
                                className="w-full bg-surface/50 border border-border rounded-xl p-4 text-sm min-h-[100px] outline-none transition-all focus:ring-2 focus:ring-primary/50 placeholder:text-text-muted resize-none leading-relaxed"
                            />
                        </div>
                    </div>
                </GlassCard>
            </motion.div>

            {/* RIGHT COLUMN: Summary & Action */}
            <motion.div variants={itemVariants} className="lg:col-span-5">
                <div className="sticky top-24 space-y-6">
                    <GlassCard className="relative overflow-hidden group border-primary/10">
                        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />

                        <h3 className="text-2xl font-bold mb-4 text-text-main">Generation Summary</h3>

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

                        <button
                            onClick={handleGenerateClick}
                            disabled={isButtonDisabled}
                            className="w-full relative group px-8 py-5 bg-primary hover:bg-primary/90 text-background rounded-xl font-bold text-lg shadow-lg shadow-primary/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none overflow-hidden"
                        >
                            <span className="relative z-10 flex items-center justify-center gap-3">
                                <Play className="w-5 h-5 fill-current" />
                                Start Generation
                            </span>
                        </button>

                        {!health?.anki_connected && (
                            <div className="mt-4 flex items-center gap-2 text-text-muted text-xs bg-surface/50 p-3 rounded-lg border border-border/50">
                                <Info className="w-4 h-4 text-text-muted" />
                                <span>Anki disconnected. Cards will be saved as drafts for later export.</span>
                            </div>
                        )}
                    </GlassCard>
                </div>
            </motion.div>
        </motion.div>
    );
}
