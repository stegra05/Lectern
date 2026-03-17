import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, Calculator, FileSearch, Info, Lock, Upload } from 'lucide-react';
import { clsx } from 'clsx';
import type { LucideIcon } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EstimationPhase = 'idle' | 'uploading' | 'analyzing' | 'calculating' | 'done';

export interface EstimationDisplay {
    phase: EstimationPhase;
    suggestedCount: number | null;
    documentType: 'slides' | 'script' | null;
    error: { title: string; message: string; action?: string } | null;
    isEstimating: boolean;
}

export interface SliderConfig {
    min: number;
    max: number;
    disabled: boolean;
    suggested?: number | null;
}

export interface ConfigurationCardProps {
    targetDeckSize: number;
    sliderConfig: SliderConfig;
    focusPrompt: string;
    estimation: EstimationDisplay;
    onTargetDeckSizeChange: (value: number) => void;
    onFocusPromptChange: (value: string) => void;
}

// ---------------------------------------------------------------------------
// Phase configuration for icons/labels
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

export function ConfigurationCard({
    targetDeckSize,
    sliderConfig,
    focusPrompt,
    estimation,
    onTargetDeckSizeChange,
    onFocusPromptChange,
}: ConfigurationCardProps) {
    const [inputValue, setInputValue] = useState(String(targetDeckSize));

    // Sync input when targetDeckSize changes from elsewhere (e.g., slider)
    useEffect(() => {
        setInputValue(String(targetDeckSize));
    }, [targetDeckSize]);

    const { phase, suggestedCount, documentType, error, isEstimating } = estimation;
    const PhaseIcon = PHASE_CONFIG[phase].icon;

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
                                onTargetDeckSizeChange(finalVal);
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
                            onChange={(e) => onTargetDeckSizeChange(parseInt(e.target.value, 10))}
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
                                    <PhaseIcon className="w-2.5 h-2.5" />
                                    {PHASE_CONFIG[phase].label || 'Estimating...'}
                                </motion.span>
                            ) : (
                                <span>{sliderConfig.disabled ? '' : suggestedCount}</span>
                            )}
                        </div>
                        <span>{sliderConfig.disabled ? '' : sliderConfig.max}</span>
                    </div>

                    {error && !isEstimating && (
                        <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                            <div className="flex items-start gap-2">
                                <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-red-300">{error.title}</p>
                                    <p className="text-xs text-red-200/80 mt-0.5">{error.message}</p>
                                    {error.action && (
                                        <p className="text-xs text-primary mt-1">{error.action}</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {suggestedCount !== null && suggestedCount !== undefined && (
                        <div className="mt-2 flex items-center gap-2 text-[11px] text-text-muted">
                            <Info className="w-3 h-3 text-primary" />
                            <span>
                                AI suggests <strong className="text-primary">{suggestedCount}</strong> based on {documentType === 'script' ? 'text density' : 'slide count'}.
                            </span>
                        </div>
                    )}
                </div>

                <div className="pt-6">
                    <label className="block text-xs font-semibold text-text-muted mb-3 uppercase tracking-wider">Focus Guidance <span className="opacity-50 lowercase tracking-normal font-normal">(Optional)</span></label>
                    <textarea
                        value={focusPrompt}
                        onChange={(e) => onFocusPromptChange(e.target.value)}
                        placeholder="E.g. 'Focus on clinical formulas' or 'Prioritize case studies'"
                        className="w-full bg-surface/30 border border-border/30 rounded-lg p-4 text-sm min-h-[100px] outline-none transition-all focus:ring-1 focus:ring-primary/50 focus:bg-surface/50 focus:border-primary/30 placeholder:text-text-muted/70 resize-none leading-relaxed"
                    />
                </div>
            </div>
        </div>
    );
}
