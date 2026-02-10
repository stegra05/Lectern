import { useMemo, useRef, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Layers, Terminal, Copy, Check, Loader2, CheckCircle2, RotateCcw, Search, Trash2, Edit2, Save, X, UploadCloud, Archive, AlertCircle } from 'lucide-react';
import { clsx } from 'clsx';
import { GlassCard } from '../components/GlassCard';
import { PhaseIndicator } from '../components/PhaseIndicator';
import { ConfirmModal } from '../components/ConfirmModal';
import { SkeletonCard } from '../components/SkeletonCard';
import { useLecternStore } from '../store';
import { filterCards, findLastError, sortCards } from '../utils/cards';
import { useTrickleProgress } from '../hooks/useTrickleProgress';

import type { Phase } from '../components/PhaseIndicator';
import type { ProgressEvent } from '../api';

// ---------------------------------------------------------------------------
// Overlay components (unchanged from original)
// ---------------------------------------------------------------------------

interface SyncOverlayProps {
    cardsCount: number;
    syncProgress: { current: number; total: number };
    syncLogs: ProgressEvent[];
}

function SyncOverlay({ cardsCount, syncProgress, syncLogs }: SyncOverlayProps) {
    const pct = Math.round((syncProgress.current / (syncProgress.total || 1)) * 100);
    const logsEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [syncLogs.length]);

    return (
        <div className="flex items-center justify-center min-h-[calc(100vh-200px)]">
            <div className="w-full max-w-2xl space-y-6">
                <GlassCard className="border-primary/20 bg-primary/5">
                    <div className="flex flex-col items-center justify-center py-12 gap-6">
                        <div className="relative w-20 h-20">
                            <svg className="w-full h-full transform -rotate-90">
                                <circle cx="40" cy="40" r="34" stroke="currentColor" strokeWidth="5" fill="none" className="text-primary/20" />
                                <motion.circle
                                    cx="40" cy="40" r="34" stroke="currentColor" strokeWidth="5" fill="none"
                                    className="text-primary"
                                    strokeLinecap="round"
                                    strokeDasharray={213.63}
                                    initial={{ strokeDashoffset: 213.63 }}
                                    animate={{ strokeDashoffset: 213.63 - (213.63 * syncProgress.current) / (syncProgress.total || 1) }}
                                    transition={{ type: "spring", stiffness: 40, damping: 15 }}
                                />
                            </svg>
                            <motion.div
                                className="absolute inset-0 flex items-center justify-center font-mono text-base font-bold text-primary"
                                key={pct}
                                initial={{ scale: 1.1, opacity: 0.7 }}
                                animate={{ scale: 1, opacity: 1 }}
                                transition={{ duration: 0.2 }}
                            >
                                {pct}%
                            </motion.div>
                        </div>
                        <div className="text-center">
                            <h3 className="text-xl font-bold text-text-main">Syncing to Anki...</h3>
                            <p className="text-text-muted mt-2">
                                Exporting {cardsCount} cards to your collection
                                {syncProgress.total > 0 && (
                                    <span className="block text-xs font-mono mt-1 text-primary/70">
                                        {syncProgress.current} / {syncProgress.total}
                                    </span>
                                )}
                            </p>
                        </div>
                    </div>
                </GlassCard>

                <GlassCard className="max-h-60 overflow-y-auto space-y-2 font-mono text-xs pr-2 scrollbar-thin scrollbar-thumb-border">
                    {syncLogs.map((log, i) => (
                        <motion.div
                            key={i}
                            initial={{ opacity: 0, x: -5 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="text-text-muted"
                        >
                            <span className="opacity-50 mr-2">{new Date(log.timestamp * 1000).toLocaleTimeString().split(' ')[0]}</span>
                            {log.message}
                        </motion.div>
                    ))}
                    <div ref={logsEndRef} />
                </GlassCard>
            </div>
        </div>
    );
}

interface SyncSuccessOverlayProps {
    syncSuccess: boolean;
}

function SyncSuccessOverlay({ syncSuccess }: SyncSuccessOverlayProps) {
    return (
        <AnimatePresence>
            {syncSuccess && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-md"
                >
                    <motion.div
                        initial={{ scale: 0.8, opacity: 0, y: 30 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 1.05, opacity: 0, y: -10 }}
                        transition={{ type: "spring", damping: 20, stiffness: 120, mass: 0.8 }}
                        className="flex flex-col items-center"
                    >
                        <div className="relative w-32 h-32 mb-8">
                            <motion.div
                                initial={{ scale: 0.8, opacity: 0 }}
                                animate={{ scale: 1.2, opacity: 1 }}
                                transition={{ duration: 0.8, repeat: Infinity, repeatType: "reverse" }}
                                className="absolute inset-0 bg-primary/20 rounded-full blur-2xl"
                            />
                            <svg className="w-full h-full" viewBox="0 0 100 100">
                                <motion.circle
                                    initial={{ pathLength: 0, opacity: 0 }}
                                    animate={{ pathLength: 1, opacity: 1 }}
                                    transition={{ duration: 0.8, ease: "easeInOut" }}
                                    cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="8"
                                    className="text-primary" strokeLinecap="round"
                                />
                                <motion.path
                                    initial={{ pathLength: 0, opacity: 0 }}
                                    animate={{ pathLength: 1, opacity: 1 }}
                                    transition={{ duration: 0.6, delay: 0.5, ease: "easeOut" }}
                                    d="M30 52L44 66L70 34" fill="none" stroke="currentColor" strokeWidth="8"
                                    className="text-primary" strokeLinecap="round" strokeLinejoin="round"
                                />
                            </svg>
                        </div>
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.8 }}
                            className="text-center"
                        >
                            <h2 className="text-3xl font-bold text-text-main mb-2 tracking-tight">Sync Complete!</h2>
                            <p className="text-text-muted font-medium">Your collection is now up to date.</p>
                        </motion.div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

interface ErrorOverlayProps {
    isError: boolean;
    lastError: string | null;
    handleCopyLogs: () => void;
    copied: boolean;
    handleReset: () => void;
    children: React.ReactNode;
}

function ErrorOverlay({ isError, lastError, handleCopyLogs, copied, handleReset, children }: ErrorOverlayProps) {
    if (!isError) {
        return <>{children}</>;
    }

    return (
        <div className="relative">
            <div className="filter blur-sm pointer-events-none opacity-50">
                {children}
            </div>

            <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            >
                <GlassCard className="max-w-md w-full border-red-500/30 bg-red-950/20 shadow-[0_0_40px_rgba(239,68,68,0.2)]">
                    <div className="flex flex-col items-center text-center p-4">
                        <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mb-4 border border-red-500/20">
                            <span className="text-3xl">⚠️</span>
                        </div>

                        <h2 className="text-xl font-bold text-red-200 mb-2">Process Interrupted</h2>

                        <div className="bg-red-950/40 p-3 rounded-lg border border-red-500/10 w-full mb-6 max-h-40 overflow-y-auto">
                            <p className="text-sm font-mono text-red-300 break-words text-left">
                                {lastError}
                            </p>
                        </div>

                        <p className="text-sm text-text-muted mb-6">
                            The generation process was stopped due to a critical error.
                            Please check the logs or try again.
                        </p>

                        <div className="flex gap-3 w-full">
                            <button
                                onClick={handleCopyLogs}
                                className="flex-1 py-2 px-4 rounded-lg border border-border bg-surface hover:bg-surface/80 text-text-muted hover:text-text-main transition-colors text-sm font-medium"
                            >
                                {copied ? "Copied Logs" : "Copy Logs"}
                            </button>
                            <button
                                onClick={handleReset}
                                className="flex-1 py-2 px-4 rounded-lg bg-red-500/80 hover:bg-red-500 text-white shadow-lg shadow-red-500/20 transition-all active:scale-95 text-sm font-bold"
                            >
                                Return to Dashboard
                            </button>
                        </div>
                    </div>
                </GlassCard>
            </motion.div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Topic helpers
// ---------------------------------------------------------------------------

function extractTopics(cards: { slide_topic?: string }[]): { topic: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const card of cards) {
        const topic = card.slide_topic || 'Uncategorized';
        counts.set(topic, (counts.get(topic) || 0) + 1);
    }
    return Array.from(counts.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([topic, count]) => ({ topic, count }));
}

function countByType(cards: { model_name?: string }[]): { basic: number; cloze: number } {
    let basic = 0, cloze = 0;
    for (const card of cards) {
        if ((card.model_name || '').toLowerCase().includes('cloze')) cloze++;
        else basic++;
    }
    return { basic, cloze };
}

/** Highlight {{c1::answer::hint}} cloze patterns with a styled span */
function highlightCloze(html: string): string {
    return html.replace(
        /\{\{c(\d+)::(.+?)(?:::(.+?))?\}\}/g,
        (_match, num, answer, hint) => {
            const label = hint ? `${answer} (${hint})` : answer;
            return `<span class="cloze-hl" data-cloze="${num}">${label}</span>`;
        }
    );
}

function isCloze(card: { model_name?: string }): boolean {
    return (card.model_name || '').toLowerCase().includes('cloze');
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ProgressView() {
    const {
        step,
        currentPhase,
        logs,
        handleCopyLogs,
        copied,
        isCancelling,
        handleCancel,
        progress,
        cards,
        handleReset,
        sessionId,
        sortBy,
        setSortBy,
        searchQuery,
        setSearchQuery,
        isHistorical,
        isError,
        editingIndex,
        editForm,
        isSyncing,
        syncSuccess,
        syncProgress,
        syncLogs,
        handleDelete,
        handleAnkiDelete,
        startEdit,
        cancelEdit,
        saveEdit,
        handleFieldChange,
        handleSync,
        confirmModal,
        setConfirmModal
    } = useLecternStore();

    const estimation = useLecternStore((s) => s.estimation);
    const setupStepsCompleted = useLecternStore((s) => s.setupStepsCompleted);

    const logsEndRef = useRef<HTMLDivElement>(null);
    const [activeTopic, setActiveTopic] = useState<string | null>(null);

    // Auto-scroll logs
    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs.length]);

    // Reset topic filter when cards change significantly
    useEffect(() => {
        setActiveTopic(null);
    }, [step]);

    const lastError = useMemo(() => findLastError(logs, isError), [isError, logs]);

    const filteredCards = useMemo(() => {
        let result = filterCards(cards, searchQuery);
        if (activeTopic) {
            result = result.filter(c => (c.slide_topic || 'Uncategorized') === activeTopic);
        }
        return result;
    }, [cards, searchQuery, activeTopic]);

    const sortedCards = useMemo(() => sortCards(filteredCards, sortBy), [filteredCards, sortBy]);

    const topics = useMemo(() => extractTopics(cards), [cards]);
    const typeCounts = useMemo(() => countByType(cards), [cards]);

    // Synthesize progress percentage from phase + batch progress:
    //   idle:        0% →  5%   (setup steps: AnkiConnect, examples, session, PDF upload)
    //   concept:     5%         (static while concept map builds)
    //   generating:  5% → 90%   (per-card progress, driven by cards.length / progress.total)
    //   reflecting: 90% → 98%   (quality pass, driven by reflection rounds)
    //   complete:   100%
    const rawProgressPct = useMemo(() => {
        if (currentPhase === 'complete' || step === 'done') return 100;
        if (currentPhase === 'reflecting') {
            const reflectPct = progress.total > 0
                ? (progress.current / progress.total)
                : 0;
            return Math.round(90 + reflectPct * 8);
        }
        if (currentPhase === 'generating') {
            // Use the higher of batch-level progress or per-card count
            const cardBased = progress.total > 0 ? (cards.length / progress.total) : 0;
            const batchBased = progress.total > 0 ? (progress.current / progress.total) : 0;
            const batchPct = Math.min(1, Math.max(cardBased, batchBased));
            return Math.round(5 + batchPct * 85);
        }
        if (currentPhase === 'concept') return 5;
        // idle: trickle based on setup steps (0 → ~5%)
        if (setupStepsCompleted > 0) {
            return Math.round(setupStepsCompleted * 1.25);
        }
        return 0;
    }, [currentPhase, progress, step, cards.length, setupStepsCompleted]);

    const progressPct = useTrickleProgress(rawProgressPct);

    // -----------------------------------------------------------------------
    // Sidebar: Generating state
    // -----------------------------------------------------------------------
    const generatingSidebar = (
        <div className="flex flex-col h-full">
            {/* Phase Stepper */}
            <div className="p-5 border-b border-border">
                <div className="flex items-center gap-2 mb-4">
                    <Layers className="w-4 h-4 text-text-muted" />
                    <h2 className="text-xs font-bold uppercase tracking-wider text-text-muted">Generation Status</h2>
                </div>
                {currentPhase && <PhaseIndicator currentPhase={currentPhase as Phase} />}
            </div>

            {/* Activity Log */}
            <div className="flex-1 flex flex-col min-h-0 p-4">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <Terminal className="w-3.5 h-3.5 text-text-muted" />
                        <h2 className="text-xs font-bold uppercase tracking-wider text-text-muted">
                            Activity Log
                            {isHistorical && sessionId && (
                                <span className="ml-1 font-mono opacity-60">#{sessionId.slice(0, 8)}</span>
                            )}
                        </h2>
                    </div>
                    <div className="flex items-center gap-2">
                        {logs.length > 0 && (
                            <button
                                onClick={handleCopyLogs}
                                className="p-1 text-text-muted hover:text-primary transition-colors rounded"
                                title="Copy logs"
                            >
                                {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                        )}
                    </div>
                </div>

                <div className="bg-background rounded-lg p-3 font-mono text-[11px] flex-1 overflow-y-auto border border-border min-h-0 scrollbar-thin scrollbar-thumb-border">
                    {/* Status header */}
                    <div className="flex items-center justify-between mb-2 border-b border-border pb-2">
                        <span className="flex items-center gap-1.5 text-primary/70">
                            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                            <span className="font-bold text-[10px] tracking-wide">PROCESSING</span>
                        </span>
                        {isCancelling ? (
                            <div className="flex items-center gap-1.5 text-red-400 text-[10px]">
                                <Loader2 className="w-3 h-3 animate-spin" />
                                <span className="font-bold tracking-wide">CANCELLING...</span>
                            </div>
                        ) : (
                            <button
                                onClick={handleCancel}
                                className="text-[10px] text-red-400 hover:text-red-300 border border-red-900/50 bg-red-900/20 px-2 py-0.5 rounded font-bold"
                            >
                                CANCEL
                            </button>
                        )}
                    </div>

                    {/* Log entries */}
                    <div className="space-y-1.5">
                        {logs.map((log, i) => (
                            <motion.div
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                key={i}
                                className={clsx("flex gap-2", {
                                    "text-blue-400": log.type === 'info',
                                    "text-yellow-400": log.type === 'warning',
                                    "text-red-400": log.type === 'error',
                                    "text-primary": log.type === 'note_created',
                                    "text-text-muted": log.type === 'status',
                                    "text-primary font-bold": log.type === 'step_start',
                                })}
                            >
                                <span className="opacity-30 shrink-0 text-text-muted">{new Date(log.timestamp * 1000).toLocaleTimeString().split(' ')[0]}</span>
                                <span className="break-words">{log.message}</span>
                            </motion.div>
                        ))}
                        <div ref={logsEndRef} />
                    </div>
                </div>
            </div>

            {/* Progress footer */}
            <div className="p-5 border-t border-border bg-surface/30">
                <div className="flex justify-between items-end mb-2">
                    <div>
                        <h3 className="text-xs font-medium text-text-main">Progress</h3>
                        <p className="text-[10px] text-text-muted mt-0.5 font-mono">
                            {currentPhase === 'concept' && 'ANALYZING SLIDES...'}
                            {currentPhase === 'generating' && `GENERATED: ${cards.length}`}
                            {currentPhase === 'reflecting' && 'REFINING QUALITY...'}
                            {currentPhase === 'complete' && `DONE — ${cards.length} CARDS`}
                            {(!currentPhase || currentPhase === 'idle') && 'STARTING...'}
                        </p>
                    </div>
                    <span className="text-xl font-bold text-primary">{progressPct}%</span>
                </div>
                <div className="h-1.5 w-full bg-surface rounded-full overflow-hidden">
                    <div
                        className="h-full bg-primary rounded-full shadow-[0_0_10px_rgba(163,230,53,0.5)] transition-all duration-500 ease-out"
                        style={{ width: `${Math.min(100, progressPct)}%` }}
                    />
                </div>
            </div>
        </div>
    );

    // -----------------------------------------------------------------------
    // Sidebar: Done / Review state
    // -----------------------------------------------------------------------
    const doneSidebar = (
        <div className="flex flex-col h-full">
            {/* Generation Insights */}
            <div className="p-5 border-b border-border">
                <div className="flex items-center gap-2 mb-4">
                    <Layers className="w-4 h-4 text-primary" />
                    <h2 className="text-xs font-bold uppercase tracking-wider text-text-muted">Generation Insights</h2>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div className="bg-background p-3 rounded-lg border border-border">
                        <div className="text-[10px] text-text-muted uppercase font-bold tracking-wider">Cards</div>
                        <div className="text-xl font-bold text-text-main mt-1">{cards.length}</div>
                    </div>
                    <div className="bg-background p-3 rounded-lg border border-border">
                        <div className="text-[10px] text-text-muted uppercase font-bold tracking-wider">Topics</div>
                        <div className="text-xl font-bold text-primary mt-1">{topics.length}</div>
                    </div>
                    <div className="bg-background p-3 rounded-lg border border-border">
                        <div className="text-[10px] text-text-muted uppercase font-bold tracking-wider">Basic</div>
                        <div className="text-xl font-bold text-text-main mt-1">{typeCounts.basic}</div>
                    </div>
                    <div className="bg-background p-3 rounded-lg border border-border">
                        <div className="text-[10px] text-text-muted uppercase font-bold tracking-wider">Cloze</div>
                        <div className="text-xl font-bold text-blue-400 mt-1">{typeCounts.cloze}</div>
                    </div>
                </div>
            </div>

            {/* Activity Log (compact) */}
            <div className="px-4 py-3 border-b border-border">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                        <Terminal className="w-3.5 h-3.5 text-text-muted" />
                        <h2 className="text-xs font-bold uppercase tracking-wider text-text-muted">
                            Activity Log
                            {isHistorical && sessionId && (
                                <span className="ml-1 font-mono opacity-60">#{sessionId.slice(0, 8)}</span>
                            )}
                        </h2>
                    </div>
                    <div className="flex items-center gap-2">
                        {logs.length > 0 && (
                            <button onClick={handleCopyLogs} className="p-1 text-text-muted hover:text-primary transition-colors rounded" title="Copy logs">
                                {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                        )}
                        <div className="flex items-center gap-1.5 text-xs text-green-400 bg-green-500/10 px-2 py-0.5 rounded border border-green-500/20">
                            <CheckCircle2 className="w-3 h-3" />
                            <span className="font-bold text-[10px] tracking-wide">COMPLETE</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Topics Filter */}
            <div className="px-4 py-3 flex items-center justify-between">
                <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider">Topics</h3>
                {activeTopic && (
                    <button
                        onClick={() => setActiveTopic(null)}
                        className="text-[10px] text-primary hover:text-primary/80 font-bold"
                    >
                        Show All
                    </button>
                )}
            </div>
            <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-1.5 min-h-0 scrollbar-thin scrollbar-thumb-border">
                {topics.map(({ topic, count }) => (
                    <button
                        key={topic}
                        onClick={() => setActiveTopic(activeTopic === topic ? null : topic)}
                        className={clsx(
                            "w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all",
                            activeTopic === topic
                                ? "bg-primary/10 border border-primary/30 shadow-sm"
                                : "hover:bg-surface border border-transparent hover:border-border"
                        )}
                    >
                        <div className="flex-1 min-w-0">
                            <h4 className={clsx(
                                "text-sm font-medium truncate",
                                activeTopic === topic ? "text-text-main" : "text-text-muted"
                            )}>
                                {topic}
                            </h4>
                        </div>
                        <span className={clsx(
                            "text-[10px] font-mono px-1.5 py-0.5 rounded",
                            activeTopic === topic
                                ? "bg-primary/10 text-primary"
                                : "bg-surface text-text-muted border border-border"
                        )}>
                            {count}
                        </span>
                    </button>
                ))}
            </div>

            {/* New Session + Sync CTA */}
            <div className="p-4 border-t border-border space-y-2">
                <button
                    onClick={() => handleSync()}
                    disabled={cards.length === 0}
                    className="w-full bg-primary hover:bg-primary/90 text-background font-bold py-3 px-4 rounded-lg flex items-center justify-center gap-2 shadow-lg shadow-primary/20 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                    <UploadCloud className="w-4 h-4" />
                    Sync to Anki
                </button>
                <button
                    onClick={handleReset}
                    className="w-full py-2.5 text-text-muted hover:text-text-main border border-border hover:border-border/80 rounded-lg font-medium text-sm transition-colors flex items-center justify-center gap-2"
                >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Start New Session
                </button>
            </div>
        </div>
    );

    // -----------------------------------------------------------------------
    // Main content area
    // -----------------------------------------------------------------------
    const content = (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex gap-0 min-h-[calc(100vh-200px)]"
        >
            {/* Left Sidebar */}
            <aside className="w-80 shrink-0 flex flex-col border-r border-border bg-surface/40 backdrop-blur-sm rounded-l-2xl overflow-hidden max-h-[calc(100vh-200px)]">
                {step === 'generating' ? generatingSidebar : doneSidebar}
            </aside>

            {/* Right: Cards Area */}
            <div className="flex-1 flex flex-col min-h-0 min-w-0 max-h-[calc(100vh-200px)]">
                {/* Toolbar */}
                <div className="h-14 px-6 border-b border-border flex items-center justify-between bg-surface/30 backdrop-blur-sm shrink-0 rounded-tr-2xl">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2 text-text-main font-semibold text-sm">
                            <Layers className="w-4 h-4 text-primary" />
                            {isHistorical ? (
                                <span className="flex items-center gap-2">
                                    Archive View
                                    <span className="px-2 py-0.5 bg-primary/10 border border-primary/20 rounded text-[10px] font-mono text-primary">HISTORICAL</span>
                                </span>
                            ) : (
                                step === 'done' ? 'Review Queue' : 'Live Preview'
                            )}
                        </div>
                        <div className="h-4 w-px bg-border" />
                        {/* Sort Pills */}
                        <div className="flex p-0.5 bg-surface/50 rounded-lg border border-border/50 text-[10px] font-bold">
                            {(['creation', 'topic', 'slide', 'type'] as const).map((opt) => (
                                <button
                                    key={opt}
                                    onClick={() => setSortBy(opt)}
                                    className={clsx(
                                        "px-3 py-1 uppercase tracking-wider rounded-md transition-all",
                                        sortBy === opt
                                            ? "bg-primary text-background shadow-sm"
                                            : "text-text-muted hover:text-text-main"
                                    )}
                                >
                                    {opt}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="relative group">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted group-focus-within:text-primary transition-colors" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search..."
                                className="pl-8 pr-3 py-1.5 text-xs bg-surface/50 border border-border/50 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50 w-36 focus:w-52 transition-all duration-300 placeholder:text-text-muted/50"
                            />
                        </div>
                        <div className="flex items-center px-2 py-1 bg-surface rounded border border-border text-[10px] font-mono text-text-muted">
                            <span className="font-bold text-text-main mr-1">{filteredCards.length}</span> CARDS
                        </div>
                    </div>
                </div>

                {/* Cards List */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-thin scrollbar-thumb-border min-h-0">
                    <AnimatePresence initial={false} mode="popLayout">
                        {sortedCards.map((card, i) => {
                            const originalIndex = cards.indexOf(card);
                            const isEditing = editingIndex === originalIndex;
                            const cloze = isCloze(card);

                            return (
                                <motion.div
                                    layout
                                    key={i}
                                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                                    animate={{ opacity: 1, scale: 1, y: 0 }}
                                    className={clsx(
                                        "bg-surface rounded-xl shadow-sm relative overflow-hidden group transition-all",
                                        isEditing
                                            ? "border-2 border-primary/50 bg-primary/5"
                                            : clsx(
                                                "border border-border hover:border-border/80 hover:shadow-md",
                                                cloze ? "border-l-4 border-l-blue-500/50" : "border-l-4 border-l-primary/50"
                                            )
                                    )}
                                >
                                    {isEditing ? (
                                        /* Edit Mode */
                                        <div className="p-5 space-y-4">
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-xs font-bold text-primary uppercase tracking-wider">Editing Card</span>
                                                <div className="flex items-center gap-2">
                                                    <button onClick={cancelEdit} className="p-1.5 hover:bg-surface rounded-lg text-text-muted hover:text-text-main transition-colors">
                                                        <X className="w-4 h-4" />
                                                    </button>
                                                    <button onClick={() => saveEdit(originalIndex)} className="p-1.5 bg-primary hover:bg-primary/90 text-background rounded-lg transition-colors">
                                                        <Save className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </div>
                                            <div className="grid gap-4">
                                                {Object.entries(editForm?.fields || {}).map(([key, value]) => (
                                                    <div key={key}>
                                                        <label className="block text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1.5">{key}</label>
                                                        <textarea
                                                            value={value as string}
                                                            onChange={(e) => handleFieldChange(key, e.target.value)}
                                                            className="w-full bg-background border border-border rounded-lg p-3 text-sm text-text-main focus:ring-1 focus:ring-primary/50 focus:border-primary/50 outline-none min-h-[100px] font-mono"
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ) : (
                                        /* View Mode */
                                        <>
                                            {/* Card header */}
                                            <div className="flex items-center justify-between px-5 py-3 border-b border-border/50">
                                                <div className="flex items-center gap-2">
                                                    <span className={clsx(
                                                        "text-[10px] font-bold tracking-wider uppercase px-1.5 py-0.5 rounded border",
                                                        cloze
                                                            ? "text-blue-400 bg-blue-500/10 border-blue-500/20"
                                                            : "text-text-muted bg-surface border-border"
                                                    )}>
                                                        {card.model_name || 'Basic'}
                                                    </span>
                                                    {card.slide_number != null && (
                                                        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface border border-border text-[10px] font-medium text-text-muted">
                                                            <Layers className="w-3 h-3" />
                                                            SLIDE {card.slide_number}
                                                        </span>
                                                    )}
                                                    {card.slide_topic && (
                                                        <span className="text-[10px] text-text-muted truncate max-w-[200px]" title={card.slide_topic}>
                                                            {card.slide_topic}
                                                        </span>
                                                    )}
                                                </div>

                                                {/* Actions (only when done) */}
                                                {step === 'done' && (
                                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <button
                                                            onClick={() => startEdit(originalIndex)}
                                                            className="p-1.5 hover:bg-surface rounded text-text-muted hover:text-primary transition-colors"
                                                            title="Edit"
                                                        >
                                                            <Edit2 className="w-3.5 h-3.5" />
                                                        </button>
                                                        <button
                                                            onClick={() => setConfirmModal({ isOpen: true, type: 'lectern', index: originalIndex })}
                                                            className="p-1.5 hover:bg-surface rounded text-text-muted hover:text-text-main transition-colors"
                                                            title="Remove"
                                                        >
                                                            <Archive className="w-3.5 h-3.5" />
                                                        </button>
                                                        {card.anki_note_id && (
                                                            <button
                                                                onClick={() => setConfirmModal({ isOpen: true, type: 'anki', index: originalIndex, noteId: card.anki_note_id })}
                                                                className="p-1.5 hover:bg-red-500/10 rounded text-red-300 hover:text-red-400 transition-colors"
                                                                title="Delete from Anki"
                                                            >
                                                                <Trash2 className="w-3.5 h-3.5" />
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Card body */}
                                            <div className="p-5 space-y-5">
                                                {Object.entries(card.fields || {}).map(([key, value]) => (
                                                    <div key={key}>
                                                        <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1.5">{key}</div>
                                                        <div className="text-sm text-text-main leading-relaxed prose prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: highlightCloze(String(value)) }} />
                                                    </div>
                                                ))}
                                            </div>

                                            {/* Card footer */}
                                        </>
                                    )}
                                </motion.div>
                            );
                        })}
                    </AnimatePresence>

                    {/* Empty State — skeleton cards during generation, plain message otherwise */}
                    {cards.length === 0 && step === 'generating' && (() => {
                        const expectedCount = progress.total || estimation?.suggested_card_count || 8;
                        return (
                            <>
                                {Array.from({ length: Math.min(expectedCount, 12) }).map((_, i) => (
                                    <SkeletonCard key={`skel-${i}`} index={i} />
                                ))}
                            </>
                        );
                    })()}
                    {cards.length === 0 && step !== 'generating' && (
                        <div className="h-full flex flex-col items-center justify-center text-text-muted border-2 border-dashed border-border rounded-xl bg-surface/20 min-h-[300px]">
                            <AlertCircle className="w-8 h-8 mb-4 opacity-20" />
                            <p className="font-medium">No cards found</p>
                            <p className="text-sm opacity-50 mt-1">Try adjusting your prompts</p>
                        </div>
                    )}
                    {/* Remaining skeleton placeholders when some cards have arrived */}
                    {cards.length > 0 && step === 'generating' && (() => {
                        const expectedCount = progress.total || estimation?.suggested_card_count || cards.length;
                        const remaining = Math.max(0, expectedCount - cards.length);
                        if (remaining === 0) return null;
                        return Array.from({ length: Math.min(remaining, 8) }).map((_, i) => (
                            <SkeletonCard key={`skel-tail-${i}`} index={i} />
                        ));
                    })()}
                </div>
            </div>

            {/* Confirmation Modal */}
            <ConfirmModal
                isOpen={confirmModal.isOpen}
                onClose={() => setConfirmModal({ ...confirmModal, isOpen: false })}
                onConfirm={() => {
                    if (confirmModal.type === 'lectern') {
                        handleDelete(confirmModal.index);
                    } else if (confirmModal.type === 'anki' && confirmModal.noteId) {
                        handleAnkiDelete(confirmModal.noteId, confirmModal.index);
                    }
                }}
                title={confirmModal.type === 'lectern' ? "Remove from Lectern?" : "Permanently Delete from Anki?"}
                description={
                    confirmModal.type === 'lectern'
                        ? "This will remove the card from your current session view safely. It does not affect Anki."
                        : "WARNING: This will permanently delete the note from your Anki collection. This action cannot be undone."
                }
                confirmText={confirmModal.type === 'lectern' ? "Remove" : "Permanently Delete"}
                variant={confirmModal.type === 'anki' ? 'destructive' : 'default'}
            />
        </motion.div>
    );

    return (
        <ErrorOverlay
            isError={isError}
            lastError={lastError}
            handleCopyLogs={handleCopyLogs}
            copied={copied}
            handleReset={handleReset}
        >
            <div className="relative">
                <SyncSuccessOverlay syncSuccess={syncSuccess} />
                <AnimatePresence mode="wait">
                    {isSyncing ? (
                        <motion.div
                            key="sync-overlay"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.3 }}
                        >
                            <SyncOverlay cardsCount={cards.length} syncProgress={syncProgress} syncLogs={syncLogs} />
                        </motion.div>
                    ) : (
                        <motion.div
                            key="main-content"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: 0.3, delay: 0.1 }}
                        >
                            {content}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </ErrorOverlay>
    );
};
