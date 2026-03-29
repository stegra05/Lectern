import { useMemo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Layers, Terminal, Copy, Check, CheckCircle2, RotateCcw, UploadCloud, Download } from 'lucide-react';

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
import { SyncOverlay, SyncSuccessOverlay, SyncPartialFailureOverlay, ErrorOverlay } from '../components/overlays';
import { useProgressViewModel } from '../hooks/useProgressViewModel';
import { sortCards } from '../utils/cards';
import { getCardPageReferences } from '../utils/cardMetadata';
import { useTrickleProgress } from '../hooks/useTrickleProgress';
import { useTimeEstimate } from '../hooks/useTimeEstimate';
import { useReviewOrchestrator } from '../hooks/useReviewOrchestrator';
import { useLecternStore } from '../store';
import { api } from '../api';
import type { SyncPreview } from '../api';
import {
    selectFilteredCards,
    selectSortedCards,
    selectUidToIndex,
    selectTypeCounts,
} from '../selectors';

import type { Phase } from '../components/PhaseIndicator';

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ProgressView() {
    // Use unified view model instead of atomic selectors
    const { state, actions } = useProgressViewModel();
    const review = useReviewOrchestrator();
    const { session, logs, progress, cards, sync, ui } = state;
    
    const {
        step,
        currentPhase,
        isCancelling,
        isHistorical,
        sessionId,
        totalPages,
        coverageData,
        rubricSummary,
    } = session;
    const { logs: logEntries, copied } = logs;
    const { progress: progressData, conceptProgress, progressPct } = progress;
    const { cards: allCards, editingIndex, editForm } = cards;
    const { isSyncing, syncPartialFailure, syncSuccess, syncProgress, syncLogs } = sync;
    const { sortBy, searchQuery, isMultiSelectMode, selectedCards, confirmModal, isCompactMode } = ui;

    // Subscribing to memoized selectors to avoid recomputing derived state on unrelated renders
    const baseFilteredCards = useLecternStore(selectFilteredCards);
    const sortedCardsGlobal = useLecternStore(selectSortedCards);
    const uidToIndex = useLecternStore(selectUidToIndex);
    const typeCounts = useLecternStore(selectTypeCounts);

    // Local state
    const [activePage, setActivePage] = useState<number | null>(null);
    const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
    const [isFocusMode, setIsFocusMode] = useState(false);
    const [syncPreview, setSyncPreview] = useState<SyncPreview | null>(null);
    const [isPreviewingSync, setIsPreviewingSync] = useState(false);

    const toNumber = (value: unknown): number | null => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    };

    const qualityScores = useMemo(() => {
        return allCards
            .map((card) => toNumber((card as Record<string, unknown>).quality_score))
            .filter((score): score is number => score !== null);
    }, [allCards]);

    const pageCoveragePct = useMemo(() => {
        const direct = toNumber(coverageData?.page_coverage_pct);
        if (direct !== null) return Math.round(direct);
        const covered = toNumber(coverageData?.covered_page_count);
        const total = toNumber(coverageData?.total_pages) ?? totalPages;
        if (covered !== null && total && total > 0) {
            return Math.round((covered / total) * 100);
        }
        return 0;
    }, [coverageData, totalPages]);

    const conceptCoveragePct = useMemo(() => {
        const direct = toNumber(coverageData?.concept_coverage_pct);
        if (direct !== null) return Math.round(direct);
        const covered = toNumber(coverageData?.covered_concept_count);
        const total = toNumber(coverageData?.total_concepts);
        if (covered !== null && total && total > 0) {
            return Math.round((covered / total) * 100);
        }
        return 0;
    }, [coverageData]);

    const highPriorityCovered = toNumber(coverageData?.high_priority_covered) ?? 0;
    const highPriorityTotal = toNumber(coverageData?.high_priority_total) ?? 0;
    const belowThresholdCount =
        rubricSummary?.below_threshold_count ??
        qualityScores.filter((score) => score < 60).length;

    // Reset filters when step changes - using render-time reset pattern to avoid cascading effects
    const [prevStep, setPrevStep] = useState(step);
    if (step !== prevStep) {
        setPrevStep(step);
        setActivePage(null);
    }

    const filteredCards = useMemo(() => {
        if (activePage !== null) {
            return baseFilteredCards.filter(c => getCardPageReferences(c).includes(activePage));
        }
        return baseFilteredCards;
    }, [baseFilteredCards, activePage]);

    const sortedCards = useMemo(() => {
        if (activePage !== null) {
            // Need to re-sort because the list changed due to local filtering
            return sortCards(filteredCards, sortBy);
        }
        return sortedCardsGlobal;
    }, [filteredCards, sortedCardsGlobal, activePage, sortBy]);

    // Continuous progress calculation using extracted logic
    const progressResult = useTrickleProgress(progressPct);

    const timeEstimate = useTimeEstimate(
        currentPhase as 'concept' | 'generating' | 'reflecting' | 'complete' | 'idle',
        progressPct,
        allCards.length,
        progressData.total
    );

    const handleExportLogs = useCallback(async () => {
        const text = logEntries
            .map(
                (log) => {
                    const dataStr = log.data ? `\n  Data: ${JSON.stringify(log.data, null, 2)}` : '';
                    return `[${new Date(log.timestamp).toISOString()}] [${log.type.toUpperCase()}] ${log.message}${dataStr}`;
                }
            )
            .join('\n\n');

        const suggestedFilename = `lectern-log-${sessionId || 'export'}.txt`;
        
        try {
            await api.saveFile(text, suggestedFilename);
        } catch (err) {
            console.error('Failed to export logs:', err);
        }
    }, [logEntries, sessionId]);

    const handlePreviewSync = useCallback(async () => {
        setIsPreviewingSync(true);
        try {
            const preview = await review.handleSyncPreview();
            if (preview) {
                setSyncPreview(preview);
            }
        } finally {
            setIsPreviewingSync(false);
        }
    }, [review]);

    const handleSyncWithPreview = useCallback(() => {
        setSyncPreview(null);
        review.handleSync();
    }, [review]);



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
                            logs={logEntries}
                            copied={copied}
                            onCopyLogs={actions.handleCopyLogs}
                            onExportLogs={handleExportLogs}
                            isCancelling={isCancelling}
                            onCancel={actions.handleCancel}
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
                progress={progressData}
                cardsLength={allCards.length}
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
                <SidebarPane title="Session Overview" icon={Layers} defaultOpen={true}>
                    {/* Top: Card Counts */}
                    <div className="grid grid-cols-3 gap-2 text-xs mb-4">
                        <div className="rounded-lg border border-border/60 bg-surface/30 p-2 flex flex-col items-center justify-center">
                            <span className="text-[10px] text-text-muted uppercase tracking-wider font-bold text-center">Total Cards</span>
                            <span className="text-2xl font-semibold text-primary">{allCards.length}</span>
                        </div>
                        <div className="rounded-lg border border-border/60 bg-surface/30 p-2 flex flex-col items-center justify-center">
                            <span className="text-[10px] text-text-muted uppercase tracking-wider font-bold text-center">Basic</span>
                            <span className="text-2xl font-semibold text-accent">{typeCounts.basic}</span>
                        </div>
                        <div className="rounded-lg border border-border/60 bg-surface/30 p-2 flex flex-col items-center justify-center">
                            <span className="text-[10px] text-text-muted uppercase tracking-wider font-bold text-center">Cloze</span>
                            <span className="text-2xl font-semibold text-blue-400">{typeCounts.cloze}</span>
                        </div>
                    </div>

                    {/* Middle: Coverage Progress */}
                    <div className="rounded-lg border border-border/60 bg-surface/20 p-4 flex flex-col items-center justify-center mb-4">
                        <h4 className="text-[10px] uppercase tracking-wider text-text-muted font-bold mb-3">Concept Coverage</h4>
                        <div className="relative w-24 h-24 mb-3">
                            <svg className="w-full h-full transform -rotate-90">
                                <circle cx="48" cy="48" r="40" stroke="currentColor" strokeWidth="8" fill="transparent" className="text-surface" />
                                <circle 
                                    cx="48" cy="48" r="40" stroke="currentColor" strokeWidth="8" fill="transparent" 
                                    strokeDasharray={251.2} 
                                    strokeDashoffset={251.2 - (251.2 * conceptCoveragePct) / 100}
                                    className="text-primary transition-all duration-1000 ease-out" 
                                />
                            </svg>
                            <div className="absolute inset-0 flex items-center justify-center">
                                <span className="text-2xl font-bold text-text-main">{conceptCoveragePct}%</span>
                            </div>
                        </div>
                        <p className="text-xs text-text-muted font-medium">Page Coverage: <span className="text-text-main">{pageCoveragePct}%</span></p>
                    </div>

                    {/* Bottom: Generation Health */}
                    <div className="rounded-lg border border-border/60 bg-surface/20 p-3">
                        <h4 className="text-[10px] uppercase tracking-wider text-text-muted font-bold mb-2">Generation Health</h4>
                        <div className="space-y-2 text-xs">
                            <div className="flex items-center justify-between">
                                <span className="text-text-muted">High-Priority Concepts:<br/>{highPriorityCovered}/{highPriorityTotal} Captured</span>
                                {highPriorityTotal > 0 && highPriorityCovered === highPriorityTotal ? (
                                    <CheckCircle2 className="w-4 h-4 text-green-400" />
                                ) : (
                                    <CheckCircle2 className="w-4 h-4 text-green-400" />
                                )}
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-text-muted">Cards Below Threshold:<br/>{belowThresholdCount}</span>
                                {belowThresholdCount === 0 ? (
                                    <CheckCircle2 className="w-4 h-4 text-green-400" />
                                ) : (
                                    <span className="text-amber-500 font-bold">Needs Review</span>
                                )}
                            </div>
                        </div>
                    </div>
                </SidebarPane>

                {/* Page Coverage */}
                <SidebarPane title="Page Coverage" icon={Layers} defaultOpen={false}>
                    <CoverageGrid
                        totalPages={totalPages}
                        cards={allCards}
                        coverageData={coverageData}
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
                            {logEntries.length > 0 && (
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
                                            actions.handleCopyLogs();
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
                            logs={logEntries}
                            copied={copied}
                            onCopyLogs={actions.handleCopyLogs}
                            onExportLogs={handleExportLogs}
                            isCancelling={isCancelling}
                            onCancel={actions.handleCancel}
                            isHistorical={isHistorical}
                            sessionId={sessionId}
                            variant="done"
                        />
                    </div>
                </SidebarPane>
            </div>

            {/* New Session + Sync CTA */}
            <div className="p-4 border-t border-border space-y-2 mt-auto">
                {syncPreview && (
                    <div
                        className={
                            syncPreview.conflict_count > 0
                                ? 'rounded-lg border border-amber-400/30 bg-amber-500/10 p-3'
                                : 'rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-3'
                        }
                    >
                        <p className="text-xs font-semibold text-text-main">Sync Preview</p>
                        <p className="mt-1 text-[11px] text-text-muted">
                            {syncPreview.create_candidates} create, {syncPreview.update_candidates} update candidates,{' '}
                            {syncPreview.conflict_count} conflicts.
                        </p>
                        {syncPreview.note_lookup_error && (
                            <p className="mt-1 text-[11px] text-amber-300">{syncPreview.note_lookup_error}</p>
                        )}
                    </div>
                )}
                <button
                    onClick={handlePreviewSync}
                    disabled={allCards.length === 0 || isPreviewingSync || isSyncing}
                    className="w-full py-2.5 text-text-main border border-border hover:border-border/80 rounded-lg font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isPreviewingSync ? 'Previewing…' : 'Preview Sync'}
                </button>
                <button
                    onClick={handleSyncWithPreview}
                    disabled={allCards.length === 0 || isPreviewingSync}
                    className="w-full bg-primary hover:bg-primary/90 text-background font-bold py-3 px-4 rounded-lg flex items-center justify-center gap-2 shadow-lg shadow-primary/20 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                    <UploadCloud className="w-4 h-4" />
                    Sync to Anki
                </button>
                <button
                    onClick={actions.handleReset}
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
                    onSortChange={actions.setSortBy}
                    searchQuery={searchQuery}
                    onSearchChange={actions.setSearchQuery}
                    isMultiSelectMode={isMultiSelectMode}
                    selectedCount={selectedCards.size}
                    onToggleMultiSelect={actions.toggleMultiSelectMode}
                    filteredCount={filteredCards.length}
                    onFocusMode={() => setIsFocusMode(true)}
                    isCompactMode={isCompactMode}
                    onToggleCompactMode={actions.setCompactMode}
                />

                {/* Virtualized Cards List */}
                <CardList
                    cards={allCards}
                    sortedCards={sortedCards}
                    uidToIndex={uidToIndex}
                    editingIndex={editingIndex}
                    editForm={editForm}
                    isMultiSelectMode={isMultiSelectMode}
                    selectedCards={selectedCards}
                    step={step}
                    isGenerating={step === 'generating'}
                    isCompactMode={isCompactMode}
                    onStartEdit={actions.startEdit}
                    onCancelEdit={actions.cancelEdit}
                    onSaveEdit={review.saveEdit}
                    onFieldChange={actions.handleFieldChange}
                    onFeedbackChange={actions.handleFeedbackChange}
                    onSetConfirmModal={actions.setConfirmModal}
                    onToggleSelection={actions.toggleCardSelection}
                    onSelectRange={actions.selectCardRange}
                    onSelectAll={actions.selectAllCards}
                    onClearSelection={actions.clearSelection}
                />
            </div>

            {/* Confirmation Modal */}
            <ConfirmModal
                isOpen={confirmModal.isOpen}
                onClose={() => actions.setConfirmModal({ ...confirmModal, isOpen: false })}
                onConfirm={() => {
                    if (confirmModal.type === 'lectern') {
                        actions.handleDelete(confirmModal.index);
                    } else if (confirmModal.type === 'anki' && confirmModal.noteId) {
                        review.handleAnkiDelete(confirmModal.noteId, confirmModal.index);
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
            isError={session.isError}
            logs={logs.logs}
            copied={logs.copied}
            onCopyLogs={actions.handleCopyLogs}
            onReset={actions.handleReset}
        >
            <div className="relative">
                <SyncSuccessOverlay
                    syncSuccess={syncSuccess}
                    onDismiss={actions.dismissSyncSuccess}
                />
                <AnimatePresence>
                    {isFocusMode && (
                        <FocusMode
                            cards={sortedCards}
                            onClose={() => setIsFocusMode(false)}
                            onDelete={(idx) => {
                                const card = sortedCards[idx];
                                const originalIdx = card?._uid ? uidToIndex.get(card._uid) : -1;
                                if (originalIdx !== undefined && originalIdx !== -1) {
                                    actions.handleDelete(originalIdx);
                                }
                            }}
                            onEdit={(idx) => {
                                const card = sortedCards[idx];
                                const originalIdx = card?._uid ? uidToIndex.get(card._uid) : -1;
                                if (originalIdx !== undefined && originalIdx !== -1) {
                                    actions.startEdit(originalIdx);
                                    setIsFocusMode(false);
                                }
                            }}
                            onSync={() => {
                                setIsFocusMode(false);
                                review.handleSync();
                            }}
                        />
                    )}
                </AnimatePresence>
                <AnimatePresence>
                    {syncPartialFailure && (
                        <SyncPartialFailureOverlay
                            syncPartialFailure={syncPartialFailure}
                            syncLogs={syncLogs}
                            onDismiss={actions.dismissSyncPartialFailure}
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
                            <SyncOverlay
                                syncProgress={syncProgress}
                                syncLogs={syncLogs}
                                cardCount={allCards.length}
                            />
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
                    onClear={actions.clearSelection}
                    onExit={actions.toggleMultiSelectMode}
                />

                {/* Batch Delete Confirmation Modal */}
                <ConfirmModal
                    isOpen={showBatchDeleteConfirm}
                    onClose={() => setShowBatchDeleteConfirm(false)}
                    onConfirm={() => {
                        actions.batchDeleteSelected();
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
