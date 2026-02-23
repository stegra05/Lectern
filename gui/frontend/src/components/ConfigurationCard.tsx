import { motion } from 'framer-motion';
import { AlertCircle, Calculator, FileSearch, Info, Lock, Upload } from 'lucide-react';
import { clsx } from 'clsx';
import { GlassCard } from './GlassCard';
import { useLecternStore } from '../store';
import { computeCardsPerUnit, computeTargetSliderConfig } from '../utils/density';
import { translateError } from '../utils/errorMessages';
import { useEstimationPhase, type EstimationPhase } from '../hooks/useEstimationPhase';
import type { LucideIcon } from 'lucide-react';

const PHASE_CONFIG: Record<EstimationPhase, { label: string; icon: LucideIcon }> = {
    idle: { label: '', icon: Upload },
    uploading: { label: 'Uploading PDF...', icon: Upload },
    analyzing: { label: 'Analyzing document...', icon: FileSearch },
    calculating: { label: 'Calculating costs...', icon: Calculator },
    done: { label: '', icon: Upload },
};

export function ConfigurationCard() {
    const targetDeckSize = useLecternStore((s) => s.targetDeckSize);
    const setTargetDeckSize = useLecternStore((s) => s.setTargetDeckSize);
    const focusPrompt = useLecternStore((s) => s.focusPrompt);
    const setFocusPrompt = useLecternStore((s) => s.setFocusPrompt);
    const estimation = useLecternStore((s) => s.estimation);
    const isEstimating = useLecternStore((s) => s.isEstimating);
    const estimationError = useLecternStore((s) => s.estimationError);
    const sourceType = useLecternStore((s) => s.sourceType);

    const estimationPhase = useEstimationPhase(isEstimating);
    const sliderConfig = computeTargetSliderConfig(estimation?.suggested_card_count);

    // Clamp targetDeckSize into slider range whenever the range changes
    const { min: sMin, max: sMax, disabled: sDisabled } = sliderConfig;
    if (!sDisabled && (targetDeckSize < sMin || targetDeckSize > sMax)) {
        const clamped = Math.min(Math.max(targetDeckSize, sMin), sMax);
        // Defer to avoid setting state during render
        queueMicrotask(() => setTargetDeckSize(clamped));
    }

    const cardsPerUnit = computeCardsPerUnit(targetDeckSize, sourceType, estimation);

    return (
        <GlassCard className="space-y-6">
            <div className="flex items-center gap-3">
                <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-surface text-text-muted font-mono text-sm">02</span>
                <h2 className="text-xl font-semibold">Configuration</h2>
            </div>

            <div className="space-y-6">
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
                        const friendlyErr = translateError(estimationError, 'estimation');
                        return (
                            <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                                <div className="flex items-start gap-2">
                                    <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-red-300">{friendlyErr.title}</p>
                                        <p className="text-xs text-red-200/80 mt-0.5">{friendlyErr.message}</p>
                                        {friendlyErr.action && (
                                            <p className="text-xs text-primary mt-1">{friendlyErr.action}</p>
                                        )}
                                        {friendlyErr.errorCode && (
                                            <p className="text-[10px] text-red-300/50 font-mono mt-2">
                                                Error: {friendlyErr.errorCode}
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
    );
}
