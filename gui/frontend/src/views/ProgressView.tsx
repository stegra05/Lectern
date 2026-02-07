import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Layers, Terminal, Copy, Check, Loader2, CheckCircle2, RotateCcw, Search, Trash2, Edit2, Save, X, UploadCloud, Archive, AlertCircle } from 'lucide-react';
import { clsx } from 'clsx';
import { GlassCard } from '../components/GlassCard';
import { PhaseIndicator } from '../components/PhaseIndicator';
import { ConfirmModal } from '../components/ConfirmModal';

import type { Step } from '../hooks/useAppState';
import type { Phase } from '../components/PhaseIndicator';
import type { SortOption } from '../hooks/useGeneration';
import type { ProgressEvent, Card } from '../api';

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
    searchQuery: string;
    setSearchQuery: (query: string) => void;
    isHistorical?: boolean;
    isError: boolean;

    // Review & Edit Props
    editingIndex: number | null;
    editForm: Card | null;
    isSyncing: boolean;
    syncProgress: { current: number; total: number };
    syncLogs: ProgressEvent[];
    handleDelete: (index: number) => void;
    handleAnkiDelete: (noteId: number, index: number) => void;
    startEdit: (index: number) => void;
    cancelEdit: () => void;
    saveEdit: (index: number) => void;
    handleFieldChange: (field: string, value: string) => void;
    handleSync: (onComplete: () => void) => void;
    confirmModal: { isOpen: boolean; type: 'lectern' | 'anki'; index: number; noteId?: number; };
    setConfirmModal: (modal: { isOpen: boolean; type: 'lectern' | 'anki'; index: number; noteId?: number; }) => void;
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
    sortBy,
    setSortBy,
    searchQuery,
    setSearchQuery,
    isError,

    // Review Props
    editingIndex,
    editForm,
    isSyncing,
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
}: ProgressViewProps) {
    // Find the last error message
    const lastError = useMemo(() => {
        if (!isError) return null;
        // Search backwards for the last error
        for (let i = logs.length - 1; i >= 0; i--) {
            if (logs[i].type === 'error') return logs[i].message;
        }
        return "Unknown error occurred";
    }, [isError, logs]);

    const filteredCards = useMemo(() => {
        if (!searchQuery.trim()) return cards;

        let regex: RegExp;
        try {
            // Advanced syntax: if starts with /, treat as regex
            // Otherwise, treat as case-insensitive substring
            if (searchQuery.startsWith('/') && searchQuery.length > 1) {
                const pattern = searchQuery.replace(/^\/|\/$/g, '');
                regex = new RegExp(pattern, 'i');
            } else {
                // Escape special regex chars for literal match
                const escaped = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                regex = new RegExp(escaped, 'i');
            }
        } catch {
            // If regex invalid, fallback to literal substring
            const escaped = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            regex = new RegExp(escaped, 'i');
        }

        return cards.filter(card => {
            const content = [
                card.front,
                card.back,
                card.tag,
                ...(card.tags || []),
                card.model_name,
                ...(Object.values(card.fields || {}))
            ].join(' ');
            return regex.test(content);
        });
    }, [cards, searchQuery]);

    const sortedCards = useMemo(() => {
        const sorted = [...filteredCards];
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
    }, [filteredCards, sortBy]);

    // Sync Overlay
    if (isSyncing) {
        return (
            <div className="flex items-center justify-center min-h-[calc(100vh-200px)]">
                <div className="w-full max-w-2xl space-y-6">
                    <GlassCard className="border-primary/20 bg-primary/5">
                        <div className="flex flex-col items-center justify-center py-12 gap-6">
                            <div className="relative w-16 h-16">
                                <svg className="w-full h-full transform -rotate-90">
                                    <circle
                                        cx="32"
                                        cy="32"
                                        r="28"
                                        stroke="currentColor"
                                        strokeWidth="4"
                                        fill="none"
                                        className="text-primary/20"
                                    />
                                    <circle
                                        cx="32"
                                        cy="32"
                                        r="28"
                                        stroke="currentColor"
                                        strokeWidth="4"
                                        fill="none"
                                        className="text-primary transition-all duration-300 ease-out"
                                        strokeDasharray={175.93}
                                        strokeDashoffset={175.93 - (175.93 * syncProgress.current) / (syncProgress.total || 1)}
                                    />
                                </svg>
                                <div className="absolute inset-0 flex items-center justify-center font-mono text-sm font-bold text-primary">
                                    {Math.round((syncProgress.current / (syncProgress.total || 1)) * 100)}%
                                </div>
                            </div>
                            <div className="text-center">
                                <h3 className="text-xl font-bold text-text-main">Syncing to Anki...</h3>
                                <p className="text-text-muted mt-2">Exporting {cards.length} cards to your collection</p>
                            </div>
                        </div>
                    </GlassCard>

                    <GlassCard className="max-h-60 overflow-y-auto space-y-2 font-mono text-xs pr-2 scrollbar-thin scrollbar-thumb-border">
                        {syncLogs.map((log, i) => (
                            <div key={i} className="text-text-muted">
                                <span className="opacity-50 mr-2">{new Date(log.timestamp * 1000).toLocaleTimeString().split(' ')[0]}</span>
                                {log.message}
                            </div>
                        ))}
                    </GlassCard>
                </div>
            </div>
        );
    }

    const content = (
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
                        {currentPhase && <PhaseIndicator currentPhase={currentPhase as Phase} />}
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

            {/* Right Column: Live Preview & Review */}
            <div className="lg:col-span-2 flex flex-col min-h-0 max-h-[calc(100vh-200px)]">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-4">
                        <h3 className="text-lg font-semibold text-text-main flex items-center gap-2">
                            <Layers className="w-5 h-5 text-text-muted" />
                            {step === 'done' ? 'Review Queue' : 'Live Preview'}
                        </h3>
                        {/* Sort Pills */}
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
                    </div>

                    <div className="flex items-center gap-4">
                        {step === 'done' && (
                            <button
                                onClick={() => handleSync(() => setStep('done'))}
                                disabled={cards.length === 0}
                                className="flex items-center gap-2 px-4 py-1.5 bg-primary hover:bg-primary/90 text-background rounded-lg font-bold shadow-lg shadow-primary/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-xs"
                            >
                                <UploadCloud className="w-3.5 h-3.5" />
                                Sync to Anki
                            </button>
                        )}
                        <div className="relative group">
                            <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                                <Search className="h-3.5 w-3.5 text-text-muted group-focus-within:text-primary transition-colors" />
                            </div>
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search..."
                                className="pl-8 pr-3 py-1 text-xs bg-surface/50 border border-border/50 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50 w-32 focus:w-48 transition-all duration-300 placeholder:text-text-muted/50"
                            />
                            <span className="text-xs font-mono text-text-muted bg-surface px-2 py-1 rounded border border-border">
                                {cards.length} CARDS
                            </span>
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto space-y-4 pr-2 pb-12 scrollbar-thin scrollbar-thumb-border min-h-0">
                    <AnimatePresence initial={false} mode="popLayout">
                        {sortedCards.map((card, i) => {
                            // Correctly identify index in the original list for editing/deleting
                            // If sorting/filtering is active, we need to map back to original index
                            const originalIndex = cards.indexOf(card);
                            const isEditing = editingIndex === originalIndex;

                            return (
                                <motion.div
                                    layout
                                    key={i}
                                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                                    animate={{ opacity: 1, scale: 1, y: 0 }}
                                    className={clsx(
                                        "bg-surface border rounded-xl shadow-lg relative overflow-hidden group transition-all",
                                        isEditing ? "border-primary/50 bg-primary/5 p-6" : "border-border p-6 hover:border-border/80"
                                    )}
                                >
                                    {isEditing ? (
                                        // Edit Mode
                                        <div className="space-y-4">
                                            <div className="flex items-center justify-between mb-4">
                                                <span className="text-xs font-bold text-primary uppercase tracking-wider">Editing Card</span>
                                                <div className="flex items-center gap-2">
                                                    <button onClick={cancelEdit} className="p-2 hover:bg-surface rounded-lg text-text-muted hover:text-text-main transition-colors">
                                                        <X className="w-4 h-4" />
                                                    </button>
                                                    <button onClick={() => saveEdit(originalIndex)} className="p-2 bg-primary hover:bg-primary/90 text-background rounded-lg transition-colors">
                                                        <Save className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </div>

                                            <div className="grid gap-4">
                                                {Object.entries(editForm?.fields || {}).map(([key, value]) => (
                                                    <div key={key}>
                                                        <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-1.5">{key}</label>
                                                        <textarea
                                                            value={value as string}
                                                            onChange={(e) => handleFieldChange(key, e.target.value)}
                                                            className="w-full bg-surface/50 border border-border rounded-lg p-3 text-sm text-text-main focus:ring-1 focus:ring-primary/50 focus:border-primary/50 outline-none min-h-[100px] font-mono"
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ) : (
                                        // View Mode
                                        <>
                                            <div className="absolute top-0 left-0 w-1 h-full bg-primary/50" />
                                            <div className="absolute top-4 right-4 flex gap-2">
                                                <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider border border-border px-2 py-1 rounded bg-background">
                                                    {card.model_name || 'Basic'}
                                                </div>

                                                {/* Actions (Only when done) */}
                                                {step === 'done' && (
                                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <button
                                                            onClick={() => startEdit(originalIndex)}
                                                            className="p-1 hover:bg-surface rounded text-text-muted hover:text-primary transition-colors"
                                                            title="Edit"
                                                        >
                                                            <Edit2 className="w-3.5 h-3.5" />
                                                        </button>
                                                        <button
                                                            onClick={() => setConfirmModal({
                                                                isOpen: true,
                                                                type: 'lectern',
                                                                index: originalIndex
                                                            })}
                                                            className="p-1 hover:bg-surface rounded text-text-muted hover:text-text-main transition-colors"
                                                            title="Remove"
                                                        >
                                                            <Archive className="w-3.5 h-3.5" />
                                                        </button>
                                                        {card.anki_note_id && (
                                                            <button
                                                                onClick={() => setConfirmModal({
                                                                    isOpen: true,
                                                                    type: 'anki',
                                                                    index: originalIndex,
                                                                    noteId: card.anki_note_id
                                                                })}
                                                                className="p-1 hover:bg-red-500/10 rounded text-red-300 hover:text-red-400 transition-colors"
                                                                title="Delete from Anki"
                                                            >
                                                                <Trash2 className="w-3.5 h-3.5" />
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
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
                                        </>
                                    )}
                                </motion.div>
                            );
                        })}
                    </AnimatePresence>

                    {cards.length === 0 && (
                        <div className="h-full flex flex-col items-center justify-center text-text-muted border-2 border-dashed border-border rounded-xl bg-surface/20 min-h-[300px]">
                            {step === 'generating' ? (
                                <>
                                    <Loader2 className="w-8 h-8 animate-spin mb-4 opacity-20" />
                                    <p className="font-medium">Waiting for cards...</p>
                                    <p className="text-sm opacity-50 mt-1">Generation will start shortly</p>
                                </>
                            ) : (
                                <>
                                    <AlertCircle className="w-8 h-8 mb-4 opacity-20" />
                                    <p className="font-medium">No cards found</p>
                                    <p className="text-sm opacity-50 mt-1">Try adjusting your prompts</p>
                                </>
                            )}
                        </div>
                    )}
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
        </motion.div >
    );

    // Error Overlay
    if (isError) {
        return (
            <div className="relative">
                {/* Background (blurred) */}
                <div className="filter blur-sm pointer-events-none opacity-50">
                    {content}
                </div>

                {/* Modal */}
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

    return content;
};
