import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, Calculator, FileSearch, Info, Lock, Upload } from 'lucide-react';
import { clsx } from 'clsx';
import { useLecternStore } from '../store';
import { computeTargetSliderConfig } from '../utils/density';
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

    const [inputValue, setInputValue] = useState(String(targetDeckSize));

    // Sync input when targetDeckSize changes from elsewhere (e.g., slider)
    useEffect(() => {
        setInputValue(String(targetDeckSize));
    }, [targetDeckSize]);

    const estimationPhase = useEstimationPhase(isEstimating);
    const sliderConfig = computeTargetSliderConfig(estimation?.suggested_card_count);

    return (
        <div className="space-y-6">
            <h2 className="text-2xl font-bold tracking-tight text-text-main">Configuration</h2>

            <div className="space-y-6">
                <div>
                    <div className="flex justify-between items-end mb-4">
                        <div className="flex items-center gap-2">
                            <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">Total Cards</label>
                            {sliderConfig.disabled && (
                                <div className="flex items-center gap-1 text-[10px] text-amber-400/80">
                                    <Lock className="w-3 h-3" />
                                    <span>Limited</span>
                                </div>
                            )}
                        </div>
                        <input
                            type="number"
                            value={inputValue}
                            disabled={sliderConfig.disabled}
                            onChange={(e) => setInputValue(e.target.value)}
                            onFocus={(e) => e.target.select()}
                            onBlur={() => {
                                const val = parseInt(inputValue, 10);
                                const finalVal = isNaN(val) || val < 1 ? 1 : val;
                                setTargetDeckSize(finalVal);
                                setInputValue(String(finalVal));
                            }}
                            className={clsx(
                                "text-right text-2xl font-bold bg-transparent border-b-2 outline-none w-20 px-2 transition-colors",
                                sliderConfig.disabled
                                    ? "text-text-muted border-transparent"
                                    : "text-primary border-primary/30 focus:border-primary focus:bg-primary/5 hover:border-primary/50"
                            )}
                        />
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
                            className="flex-1 h-1 bg-surface rounded-lg appearance-none cursor-pointer accent-primary"
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
                                    {PHASE_CONFIG[estimationPhase].label || 'Estimating...'}
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
                                    </div>
                                </div>
                            </div>
                        );
                    })()}

                    {estimation?.suggested_card_count !== undefined && (
                        <div className="mt-2 flex items-center gap-2 text-[11px] text-text-muted">
                            <Info className="w-3 h-3 text-primary" />
                            <span>
                                AI suggests <strong className="text-primary">{estimation.suggested_card_count}</strong> based on {estimation.document_type === 'script' ? 'text density' : 'slide count'}.
                            </span>
                        </div>
                    )}
                </div>

                <div className="pt-6">
                    <label className="block text-xs font-semibold text-text-muted mb-3 uppercase tracking-wider">Focus Guidance <span className="opacity-50 lowercase tracking-normal font-normal">(Optional)</span></label>
                    <textarea
                        value={focusPrompt}
                        onChange={(e) => setFocusPrompt(e.target.value)}
                        placeholder="E.g. 'Focus on clinical formulas' or 'Prioritize case studies'"
                        className="w-full bg-surface/30 border border-border/30 rounded-lg p-4 text-sm min-h-[100px] outline-none transition-all focus:ring-1 focus:ring-primary/50 focus:bg-surface/50 focus:border-primary/30 placeholder:text-text-muted/70 resize-none leading-relaxed"
                    />
                </div>
            </div>
        </div>
    );
}
