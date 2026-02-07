import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Layers, Terminal, Copy, Check, Loader2, CheckCircle2, RotateCcw } from 'lucide-react';
import { clsx } from 'clsx';
import { GlassCard } from '../components/GlassCard';
import { PhaseIndicator } from '../components/PhaseIndicator';
import { ReviewQueue } from '../components/ReviewQueue';

import type { Step } from '../hooks/useAppState';
import type { Phase } from '../components/PhaseIndicator';
import type { Card, SortOption } from '../hooks/useGeneration';
import type { ProgressEvent } from '../api';

interface ProgressViewProps {
    step: Step;
    setStep: (step: Step) => void;
    currentPhase: Phase;
    logs: ProgressEvent[];
    handleCopyLogs: () => void;
    copied: boolean;
    isCancelling: boolean;
    handleCancel: () => void;
    progress: { current: number; total: number };
    cards: Card[];
    handleReset: () => void;
    setPreviewSlide: (slide: number | null) => void;
    logsEndRef: React.RefObject<HTMLDivElement>;
    sessionId?: string | null;
    sortBy: SortOption;
    setSortBy: (opt: SortOption) => void;
}

export function ProgressView({
    step,
    setStep,
    currentPhase,
    logs,
    handleCopyLogs,
    copied,
    isCancelling,
    handleCancel,
    progress,
    cards,
    handleReset,
    setPreviewSlide,
    logsEndRef,
    sessionId,
    sortBy,
    setSortBy
}: ProgressViewProps) {
    const sortedCards = useMemo(() => {
        const sorted = [...cards];
        switch (sortBy) {
            case 'topic':
                return sorted.sort((a, b) => (a.slide_topic || '').localeCompare(b.slide_topic || ''));
            case 'slide':
                return sorted.sort((a, b) => (a.slide_number || 0) - (b.slide_number || 0));
            case 'type':
                return sorted.sort((a, b) => (a.model_name || '').localeCompare(b.model_name || ''));
            default:
                return sorted; // creation order
        }
    }, [cards, sortBy]);

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="grid grid-cols-1 lg:grid-cols-3 gap-8 min-h-[calc(100vh-200px)]"
        >
            {/* Left Column: Logs & Progress */}
            <div className="lg:col-span-1 flex flex-col gap-6 max-h-[calc(100vh-200px)]">
                {step === 'generating' && (
                    <GlassCard className="shrink-0">
                        <h3 className="font-semibold text-text-main mb-4 flex items-center gap-2">
                            <Layers className="w-4 h-4 text-text-muted" />
                            Generation Status
                        </h3>
                        <PhaseIndicator currentPhase={currentPhase as Phase} />
                    </GlassCard>
                )}

                <GlassCard className="flex-1 flex flex-col min-h-0 max-h-[calc(100vh-400px)] border-border/80">
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="font-semibold text-text-main flex items-center gap-2">
                            <Terminal className="w-4 h-4 text-text-muted" />
                            Activity Log
                        </h3>
                        <div className="flex items-center gap-2">
                            {logs.length > 0 && (
                                <button
                                    onClick={handleCopyLogs}
                                    className="p-1 text-text-muted hover:text-primary transition-colors rounded-md hover:bg-surface/80"
                                    title="Copy logs"
                                >
                                    {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                                </button>
                            )}
                            <div className="flex items-center gap-3">
                                {step === 'generating' ? (
                                    <div className="flex items-center gap-2 text-xs text-primary bg-primary/10 px-2 py-1 rounded-md border border-primary/20">
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                        <span className="font-medium tracking-wide">PROCESSING</span>
                                    </div>
                                ) : (
                                    step === 'done' && (
                                        <div className="flex items-center gap-2 text-xs text-green-400 bg-green-500/10 px-2 py-1 rounded-md border border-green-500/20">
                                            <CheckCircle2 className="w-3 h-3" />
                                            <span className="font-medium tracking-wide">COMPLETE</span>
                                        </div>
                                    )
                                )}
                                {step === 'generating' && (
                                    isCancelling ? (
                                        <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 px-3 py-1 rounded-md border border-red-500/20">
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                            <span className="font-medium tracking-wide">CANCELLING...</span>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={handleCancel}
                                            className="text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 px-3 py-1 rounded-md transition-colors border border-red-500/20 font-medium hover:border-red-500/40"
                                        >
                                            CANCEL
                                        </button>
                                    )
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto space-y-3 pr-2 font-mono text-xs scrollbar-thin scrollbar-thumb-border min-h-0">
                        {logs.map((log, i) => (
                            <motion.div
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                key={i}
                                className={clsx("flex gap-3 p-2 rounded hover:bg-surface/50 transition-colors", {
                                    "text-blue-400": log.type === 'info',
                                    "text-yellow-400": log.type === 'warning',
                                    "text-red-400": log.type === 'error',
                                    "text-primary": log.type === 'note_created',
                                    "text-text-muted": log.type === 'status',
                                    "text-primary font-bold": log.type === 'step_start',
                                })}
                            >
                                <span className="opacity-30 shrink-0">{new Date(log.timestamp * 1000).toLocaleTimeString().split(' ')[0]}</span>
                                <span className="break-words">{log.message}</span>
                            </motion.div>
                        ))}
                        <div ref={logsEndRef} />
                    </div>
                </GlassCard>

                <GlassCard>
                    <div className="flex justify-between text-sm mb-3 text-text-muted">
                        <span className="font-medium">Progress</span>
                        <span className="font-mono">{Math.round((progress.current / (progress.total || 1)) * 100)}%</span>
                    </div>
                    <div className="h-2 bg-surface rounded-full overflow-hidden">
                        <motion.div
                            className="h-full bg-primary"
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.min(100, (progress.current / (progress.total || 1)) * 100)}%` }}
                            transition={{ type: "spring", stiffness: 50 }}
                        />
                    </div>
                    <div className="mt-4 flex justify-between text-xs text-text-muted font-mono">
                        <span>GENERATED: {cards.length}</span>
                    </div>
                </GlassCard>

                {step === 'done' && (
                    <GlassCard className="border-primary/20 bg-primary/5">
                        <div className="flex flex-col gap-4">
                            <div className="flex items-center gap-3 text-primary">
                                <CheckCircle2 className="w-6 h-6" />
                                <div>
                                    <h3 className="font-bold">Generation Complete</h3>
                                    <p className="text-xs text-primary/70">All cards have been exported to Anki</p>
                                </div>
                            </div>
                            <button
                                onClick={handleReset}
                                className="w-full py-3 bg-primary hover:bg-primary/90 text-background rounded-lg font-bold text-sm transition-colors flex items-center justify-center gap-2 shadow-lg shadow-primary/10 hover:shadow-primary/20"
                            >
                                <RotateCcw className="w-4 h-4" />
                                Start New Session
                            </button>
                        </div>
                    </GlassCard>
                )}
            </div>

            {/* Right Column: Live Preview or Review Queue */}
            <div className="lg:col-span-2 flex flex-col min-h-0 max-h-[calc(100vh-200px)]">
                {step === 'review' ? (
                    <ReviewQueue
                        initialCards={sortedCards}
                        onSyncComplete={() => setStep('done')}
                        sessionId={sessionId}
                    />
                ) : (
                    <>
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold text-text-main flex items-center gap-2">
                                <Layers className="w-5 h-5 text-text-muted" /> Live Preview
                            </h3>
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-1.5 bg-surface/50 p-1 rounded-lg border border-border/50">
                                    {(['creation', 'topic', 'slide', 'type'] as const).map((opt) => (
                                        <button
                                            key={opt}
                                            onClick={() => setSortBy(opt)}
                                            className={clsx(
                                                "px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all",
                                                sortBy === opt
                                                    ? "bg-primary text-background shadow-lg shadow-primary/20"
                                                    : "text-text-muted hover:text-text-main hover:bg-surface"
                                            )}
                                        >
                                            {opt}
                                        </button>
                                    ))}
                                </div>
                                <span className="text-xs font-mono text-text-muted bg-surface px-2 py-1 rounded border border-border">
                                    {cards.length} CARDS
                                </span>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto space-y-4 pr-2 pb-12 scrollbar-thin scrollbar-thumb-border min-h-0">
                            <AnimatePresence initial={false}>
                                {sortedCards.map((card, i) => (
                                    <motion.div
                                        key={i}
                                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                                        animate={{ opacity: 1, scale: 1, y: 0 }}
                                        className="bg-surface border border-border rounded-xl p-6 shadow-lg relative overflow-hidden group hover:border-border/80 transition-colors"
                                    >
                                        <div className="absolute top-0 left-0 w-1 h-full bg-primary/50" />
                                        <div className="absolute top-4 right-4 text-[10px] font-bold text-text-muted uppercase tracking-wider border border-border px-2 py-1 rounded bg-background">
                                            {card.model_name || 'Basic'}
                                        </div>

                                        <div className="space-y-6 mt-2">
                                            {Object.entries(card.fields || {}).map(([key, value]) => (
                                                <div key={key}>
                                                    <div className="text-[10px] text-text-muted font-bold uppercase tracking-widest mb-1.5">{key}</div>
                                                    <div className="text-sm text-text-main leading-relaxed prose prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: String(value) }} />
                                                </div>
                                            ))}
                                        </div>

                                        <div className="mt-6 flex flex-wrap gap-2">
                                            {(card.tags || []).map((tag: string) => (
                                                <span key={tag} className="px-2.5 py-1 bg-background text-text-muted text-xs rounded-md font-medium border border-border">
                                                    #{tag}
                                                </span>
                                            ))}
                                        </div>

                                        {card.slide_number && (
                                            <div className="absolute bottom-4 right-4">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setPreviewSlide(card.slide_number ?? null);
                                                    }}
                                                    className="flex items-center gap-1.5 px-2 py-1 rounded bg-background hover:bg-surface border border-border text-[10px] font-medium text-text-muted hover:text-text-main transition-colors"
                                                >
                                                    <Layers className="w-3 h-3" />
                                                    SLIDE {card.slide_number}
                                                </button>
                                            </div>
                                        )}
                                    </motion.div>
                                ))}
                            </AnimatePresence>

                            {cards.length === 0 && (
                                <div className="h-full flex flex-col items-center justify-center text-text-muted border-2 border-dashed border-border rounded-xl bg-surface/20">
                                    <Loader2 className="w-8 h-8 animate-spin mb-4 opacity-20" />
                                    <p className="font-medium">Waiting for cards...</p>
                                    <p className="text-sm opacity-50 mt-1">Generation will start shortly</p>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
        </motion.div>
    );
};
