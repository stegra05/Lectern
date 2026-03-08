import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Layers, Terminal, Copy, Check, CheckCircle2, RotateCcw, UploadCloud, Download } from 'lucide-react';
import { GlassCard } from '../components/GlassCard';
import { PhaseIndicator } from '../components/PhaseIndicator';
import { ConfirmModal } from '../components/ConfirmModal';
import { CoverageGrid } from '../components/CoverageGrid';
import { SidebarPane } from '../components/SidebarPane';
import { BatchActionBar } from '../components/BatchActionBar';
import { FocusMode } from '../components/FocusMode';
import { ActivityLog } from '../components/ActivityLog';
import { ProgressFooter } from '../components/ProgressFooter';
import { CardToolbar } from '../components/CardToolbar';
import { CardList } from '../components/CardList';
import { useLecternStore } from '../store';
import { useLogsState, useProgressState, useSessionState, useCardsState, useSyncState, useUIState, useLecternActions } from '../hooks/useLecternSelectors';
import { filterCards, findLastError, sortCards } from '../utils/cards';
import { useTrickleProgress } from '../hooks/useTrickleProgress';
import { useTimeEstimate } from '../hooks/useTimeEstimate';
import { type FriendlyError, translateError } from '../utils/errorMessages';

import type { Phase } from '../components/PhaseIndicator';
import type { ProgressEvent } from '../api';

// ---------------------------------------------------------------------------
// Overlay components
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

interface SyncPartialFailureOverlayProps {
    failedCount: number;
    createdCount: number;
    syncLogs: ProgressEvent[];
    onDismiss: () => void;
}

function SyncPartialFailureOverlay({
    failedCount,
    createdCount,
    syncLogs,
    onDismiss,
}: SyncPartialFailureOverlayProps) {
    const [copied, setCopied] = useState(false);

    const failureLogs = syncLogs.filter(
        (log) => log.type === 'warning' || log.type === 'error'
    );

    const handleCopyLogs = useCallback(() => {
        const text = syncLogs
            .map(
                (log) =>
                    `[${new Date(log.timestamp * 1000).toLocaleTimeString()}] ${log.type.toUpperCase()}: ${log.message}`
            )
            .join('\n');
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, [syncLogs]);

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/80 backdrop-blur-md"
        >
            <GlassCard className="max-w-md w-full border-yellow-500/30 bg-yellow-950/10 shadow-[0_0_40px_rgba(234,179,8,0.15)]">
                <div className="flex flex-col items-center text-center p-4">
                    <div className="w-16 h-16 rounded-full bg-yellow-500/10 flex items-center justify-center mb-4 border border-yellow-500/20">
                        <svg className="w-8 h-8 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                    </div>

                    <h2 className="text-xl font-bold text-yellow-200 mb-2">Sync Completed with Errors</h2>

                    <p className="text-sm text-text-muted mb-4">
                        {createdCount} card{createdCount !== 1 ? 's' : ''} synced, {failedCount} failed
                    </p>

                    {failureLogs.length > 0 && (
                        <div className="bg-yellow-950/40 p-3 rounded-lg border border-yellow-500/10 w-full mb-4 max-h-32 overflow-y-auto">
                            <div className="space-y-1 text-left">
                                {failureLogs.slice(0, 5).map((log, i) => (
                                    <p key={i} className="text-xs font-mono text-yellow-300/80 break-words">
                                        {log.message}
                                    </p>
                                ))}
                                {failureLogs.length > 5 && (
                                    <p className="text-xs text-text-muted italic">
                                        ...and {failureLogs.length - 5} more
                                    </p>
                                )}
                            </div>
                        </div>
                    )}

                    <div className="flex gap-3 w-full">
                        <button
                            onClick={handleCopyLogs}
                            className="flex-1 py-2 px-4 rounded-lg border border-border bg-surface hover:bg-surface/80 text-text-muted hover:text-text-main transition-colors text-sm font-medium"
                        >
                            {copied ? "Copied Logs" : "Copy Logs"}
                        </button>
                        <button
                            onClick={onDismiss}
                            className="flex-1 py-2 px-4 rounded-lg bg-yellow-500/80 hover:bg-yellow-500 text-background font-bold shadow-lg shadow-yellow-500/20 transition-all active:scale-95 text-sm"
                        >
                            Dismiss
                        </button>
                    </div>
                </div>
            </GlassCard>
        </motion.div>
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

    const friendlyError: FriendlyError = translateError(lastError, 'generation');

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
                            <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </div>

                        <h2 className="text-xl font-bold text-red-200 mb-2">{friendlyError.title}</h2>

                        <p className="text-sm text-text-muted mb-4">
                            {friendlyError.message}
                        </p>

                        {friendlyError.action && (
                            <p className="text-sm text-primary mb-4">
                                {friendlyError.action}
                            </p>
                        )}

                        {friendlyError.errorCode && (
                            <div className="bg-red-950/40 p-2 rounded-lg border border-red-500/10 w-full mb-4">
                                <p className="text-[10px] font-mono text-red-300/60 break-words text-center">
                                    Error code: {friendlyError.errorCode}
                                </p>
                            </div>
                        )}

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

function countByType(cards: { model_name?: string }[]): { basic: number; cloze: number } {
    let basic = 0, cloze = 0;
    for (const card of cards) {
        if ((card.model_name || '').toLowerCase().includes('cloze')) cloze++;
        else basic++;
    }
    return { basic, cloze };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ProgressView() {
    // Use atomic selectors instead of full store destructuring
    const { step, currentPhase, isError, isCancelling, isHistorical, sessionId, totalPages } = useSessionState();
    const { logs, copied } = useLogsState();
    const { progress, conceptProgress, setupStepsCompleted } = useProgressState();
    const { cards, editingIndex, editForm } = useCardsState();
    const { isSyncing, syncSuccess, syncPartialFailure, syncProgress, syncLogs } = useSyncState();
    const { sortBy, searchQuery, isMultiSelectMode, selectedCards } = useUIState();

    // Get all actions (stable references)
    const {
        handleCopyLogs,
        handleCancel,
        handleReset,
        handleDelete,
        handleAnkiDelete,
        startEdit,
        cancelEdit,
        saveEdit,
        handleFieldChange,
        handleSync,
        setConfirmModal,
        setSortBy,
        setSearchQuery,
        toggleMultiSelectMode,
        toggleCardSelection,
        selectCardRange,
        selectAllCards,
        clearSelection,
        batchDeleteSelected,
    } = useLecternActions();

    // Local state
    const [activePage, setActivePage] = useState<number | null>(null);
    const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
    const [isFocusMode, setIsFocusMode] = useState(false);
    const confirmModal = useLecternStore((s) => s.confirmModal);

    // Reset filters when step changes
    useEffect(() => {
        setActivePage(null);
    }, [step]);

    const lastError = useMemo(() => findLastError(logs, isError), [isError, logs]);

    const filteredCards = useMemo(() => {
        let result = filterCards(cards, searchQuery);
        if (activePage !== null) {
            result = result.filter(c => {
                const slideNum = c.slide_number ?? (c.metadata as { slide_number?: number })?.slide_number;
                return slideNum === activePage;
            });
        }
        return result;
    }, [cards, searchQuery, activePage]);

    const sortedCards = useMemo(() => sortCards(filteredCards, sortBy), [filteredCards, sortBy]);

    // O(1) lookup: card._uid -> original index in cards[]
    const uidToIndex = useMemo(() => {
        const map = new Map<string, number>();
        cards.forEach((c, i) => { if (c._uid) map.set(c._uid, i); });
        return map;
    }, [cards]);

    const typeCounts = useMemo(() => countByType(cards), [cards]);

    // Continuous progress calculation
    const rawProgressPct = useMemo(() => {
        if (currentPhase === 'complete' || step === 'done') return 100;

        const conceptWeight = 0.10;
        const generatingWeight = 0.85;
        const reflectingWeight = 0.05;

        const conceptPct = conceptProgress.total > 0
            ? (conceptProgress.current / conceptProgress.total)
            : 0;

        const cardBased = progress.total > 0 ? (cards.length / progress.total) : 0;
        const batchBased = progress.total > 0 ? (progress.current / progress.total) : 0;
        const generatingPct = Math.min(1, Math.max(cardBased, batchBased));

        const reflectPct = progress.total > 0
            ? (progress.current / progress.total)
            : 0;

        if (currentPhase === 'concept') {
            return Math.max(1, Math.round(conceptPct * conceptWeight * 100));
        }
        if (currentPhase === 'generating') {
            return Math.round((conceptWeight + generatingPct * generatingWeight) * 100);
        }
        if (currentPhase === 'reflecting') {
            return Math.round((conceptWeight + generatingWeight + reflectPct * reflectingWeight) * 100);
        }

        if (setupStepsCompleted > 0) {
            return Math.max(1, Math.round(setupStepsCompleted * 2));
        }
        return 1;
    }, [currentPhase, progress, step, cards.length, setupStepsCompleted, conceptProgress]);

    const progressResult = useTrickleProgress(rawProgressPct);

    const timeEstimate = useTimeEstimate(
        currentPhase as 'concept' | 'generating' | 'reflecting' | 'complete' | 'idle',
        rawProgressPct,
        cards.length,
        progress.total
    );

    const handleExportLogs = useCallback(() => {
        const text = logs
            .map(
                (log) => {
                    const dataStr = log.data ? `\n  Data: ${JSON.stringify(log.data, null, 2)}` : '';
                    return `[${new Date(log.timestamp).toISOString()}] [${log.type.toUpperCase()}] ${log.message}${dataStr}`;
                }
            )
            .join('\n\n');
        
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `lectern-log-${sessionId || 'export'}.txt`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }, [logs, sessionId]);

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

            <div className="flex-1 overflow-y-auto min-h-0 scrollbar-thin scrollbar-thumb-border">
                <SidebarPane title="Activity Log" icon={Terminal} defaultOpen={false}>
                    <div className="h-64">
                        <ActivityLog
                            logs={logs}
                            copied={copied}
                            onCopyLogs={handleCopyLogs}
                            onExportLogs={handleExportLogs}
                            isCancelling={isCancelling}
                            onCancel={handleCancel}
                            isHistorical={isHistorical}
                            sessionId={sessionId}
                            variant="generating"
                        />
                    </div>
                </SidebarPane>
            </div>

            {/* Progress footer */}
            <ProgressFooter
                currentPhase={currentPhase as Phase}
                conceptProgress={conceptProgress}
                progress={progress}
                cardsLength={cards.length}
                progressDisplay={progressResult.display}
                timeEstimate={timeEstimate}
            />
        </div>
    );

    // -----------------------------------------------------------------------
    // Sidebar: Done / Review state
    // -----------------------------------------------------------------------
    const doneSidebar = (
        <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto min-h-0 scrollbar-thin scrollbar-thumb-border">
                {/* Generation Insights */}
                <SidebarPane title="Insights" icon={Layers} defaultOpen={true}>
                    <div className="flex items-center justify-between px-2 py-1">
                        <div className="flex flex-col">
                            <span className="text-[10px] text-text-muted uppercase tracking-wider font-bold">Cards</span>
                            <span className="text-xl font-bold text-text-main">{cards.length}</span>
                        </div>
                        <div className="w-px h-8 bg-border/50 mx-2"></div>
                        <div className="flex flex-col">
                            <span className="text-[10px] text-text-muted uppercase tracking-wider font-bold">Basic</span>
                            <span className="text-xl font-bold text-text-main">{typeCounts.basic}</span>
                        </div>
                        <div className="w-px h-8 bg-border/50 mx-2"></div>
                        <div className="flex flex-col">
                            <span className="text-[10px] text-text-muted uppercase tracking-wider font-bold">Cloze</span>
                            <span className="text-xl font-bold text-blue-400">{typeCounts.cloze}</span>
                        </div>
                    </div>
                </SidebarPane>

                {/* Page Coverage */}
                <SidebarPane title="Page Coverage" icon={Layers} defaultOpen={false}>
                    <CoverageGrid
                        totalPages={totalPages}
                        cards={cards}
                        activePage={activePage}
                        onPageClick={(page) => {
                            setActivePage(prev => prev === page ? null : page);
                        }}
                    />
                </SidebarPane>

                {/* Activity Log */}
                <SidebarPane
                    title="Activity Log"
                    icon={Terminal}
                    defaultOpen={false}
                    rightElement={
                        <div className="flex items-center gap-2">
                            {logs.length > 0 && (
                                <>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleExportLogs();
                                        }}
                                        className="p-1 text-text-muted hover:text-primary transition-colors rounded"
                                        title="Export logs"
                                    >
                                        <Download className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleCopyLogs();
                                        }}
                                        className="p-1 text-text-muted hover:text-primary transition-colors rounded"
                                        title="Copy logs"
                                    >
                                        {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                                    </button>
                                </>
                            )}
                            <div className="flex items-center gap-1.5 text-[10px] text-green-400 font-bold tracking-wide">
                                <CheckCircle2 className="w-3 h-3" />
                                DONE
                            </div>
                        </div>
                    }
                >
                    <div className="h-64">
                        <ActivityLog
                            logs={logs}
                            copied={copied}
                            onCopyLogs={handleCopyLogs}
                            onExportLogs={handleExportLogs}
                            isCancelling={isCancelling}
                            onCancel={handleCancel}
                            isHistorical={isHistorical}
                            sessionId={sessionId}
                            variant="done"
                        />
                    </div>
                </SidebarPane>
            </div>

            {/* New Session + Sync CTA */}
            <div className="p-4 border-t border-border space-y-2 mt-auto">
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
                <CardToolbar
                    step={step}
                    isHistorical={isHistorical}
                    sortBy={sortBy}
                    onSortChange={setSortBy}
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                    isMultiSelectMode={isMultiSelectMode}
                    onToggleMultiSelect={toggleMultiSelectMode}
                    filteredCount={filteredCards.length}
                    onFocusMode={() => setIsFocusMode(true)}
                />

                {/* Virtualized Cards List */}
                <CardList
                    cards={cards}
                    sortedCards={sortedCards}
                    uidToIndex={uidToIndex}
                    editingIndex={editingIndex}
                    editForm={editForm}
                    isMultiSelectMode={isMultiSelectMode}
                    selectedCards={selectedCards}
                    step={step}
                    isGenerating={step === 'generating'}
                    onStartEdit={startEdit}
                    onCancelEdit={cancelEdit}
                    onSaveEdit={saveEdit}
                    onFieldChange={handleFieldChange}
                    onSetConfirmModal={setConfirmModal}
                    onToggleSelection={toggleCardSelection}
                    onSelectRange={selectCardRange}
                    onSelectAll={selectAllCards}
                    onClearSelection={clearSelection}
                />
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

    const dismissSyncPartialFailure = useCallback(() => {
        useLecternStore.setState({ syncPartialFailure: null });
    }, []);

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
                <AnimatePresence>
                    {isFocusMode && (
                        <FocusMode
                            cards={sortedCards}
                            onClose={() => setIsFocusMode(false)}
                            onDelete={(idx) => {
                                const card = sortedCards[idx];
                                const originalIdx = card?._uid ? uidToIndex.get(card._uid) : -1;
                                if (originalIdx !== undefined && originalIdx !== -1) {
                                    handleDelete(originalIdx);
                                }
                            }}
                            onEdit={(idx) => {
                                const card = sortedCards[idx];
                                const originalIdx = card?._uid ? uidToIndex.get(card._uid) : -1;
                                if (originalIdx !== undefined && originalIdx !== -1) {
                                    startEdit(originalIdx);
                                    setIsFocusMode(false);
                                }
                            }}
                            onSync={() => {
                                setIsFocusMode(false);
                                handleSync();
                            }}
                        />
                    )}
                </AnimatePresence>
                <AnimatePresence>
                    {syncPartialFailure && (
                        <SyncPartialFailureOverlay
                            failedCount={syncPartialFailure.failed}
                            createdCount={syncPartialFailure.created}
                            syncLogs={syncLogs}
                            onDismiss={dismissSyncPartialFailure}
                        />
                    )}
                </AnimatePresence>
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

                {/* Batch Action Bar */}
                <BatchActionBar
                    selectedCount={selectedCards.size}
                    onDelete={() => setShowBatchDeleteConfirm(true)}
                    onClear={clearSelection}
                    onExit={toggleMultiSelectMode}
                />

                {/* Batch Delete Confirmation Modal */}
                <ConfirmModal
                    isOpen={showBatchDeleteConfirm}
                    onClose={() => setShowBatchDeleteConfirm(false)}
                    onConfirm={() => {
                        batchDeleteSelected();
                        setShowBatchDeleteConfirm(false);
                    }}
                    title={`Delete ${selectedCards.size} Card${selectedCards.size !== 1 ? 's' : ''}?`}
                    description="This will remove the selected cards from your current session. This action cannot be undone."
                    confirmText="Delete"
                    variant="destructive"
                />
            </div>
        </ErrorOverlay>
    );
}
