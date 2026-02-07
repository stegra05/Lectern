import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, Trash2, Check, X, ChevronRight } from 'lucide-react';
import { GlassCard } from './GlassCard';
import type { HistoryEntry } from '../api';

interface HistoryModalProps {
    isOpen: boolean;
    onClose: () => void;
    history: HistoryEntry[];
    clearAllHistory: () => void;
    deleteHistoryEntry: (id: string) => void;
    loadSession: (sessionId: string) => void;
}

export function HistoryModal({
    isOpen,
    onClose,
    history,
    clearAllHistory,
    deleteHistoryEntry,
    loadSession,
}: HistoryModalProps) {
    type FilterType = 'all' | 'completed' | 'draft' | 'error';

    const [historyFilter, setHistoryFilter] = useState<FilterType>(() => {
        const saved = localStorage.getItem('lectern-history-filter');
        return (saved as FilterType) || 'completed';
    });

    useEffect(() => {
        localStorage.setItem('lectern-history-filter', historyFilter);
    }, [historyFilter]);

    const counts = {
        all: history.length,
        completed: history.filter(h => h.status === 'completed').length,
        draft: history.filter(h => h.status === 'draft').length,
        error: history.filter(h => h.status === 'error').length,
    };

    const filteredHistory = historyFilter === 'all'
        ? history
        : history.filter(h => h.status === historyFilter);

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                    />

                    {/* Modal Content */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        className="relative w-full max-w-2xl max-h-[80vh] flex flex-col"
                    >
                        <GlassCard className="flex-1 flex flex-col p-0 overflow-hidden border-primary/20 bg-surface/90 shadow-2xl">
                            {/* Header */}
                            <div className="flex items-center justify-between p-6 border-b border-border/50">
                                <div className="flex items-center gap-3">
                                    <Clock className="w-5 h-5 text-primary" />
                                    <h2 className="text-xl font-bold text-text-main">Recent Sessions</h2>
                                </div>
                                <div className="flex items-center gap-4">
                                    {history.length > 0 && (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (confirm('Clear all history?')) {
                                                    clearAllHistory();
                                                }
                                            }}
                                            className="text-xs text-text-muted hover:text-red-400 transition-colors flex items-center gap-1 px-2 py-1"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                            Clear All
                                        </button>
                                    )}
                                    <button
                                        onClick={onClose}
                                        className="p-2 hover:bg-surface/50 rounded-lg text-text-muted hover:text-text-main transition-colors"
                                    >
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>
                            </div>

                            {/* Filters */}
                            <div className="px-6 py-4 bg-surface/30 border-b border-border/30 flex flex-wrap gap-2">
                                {[
                                    { id: 'all', label: 'All' },
                                    { id: 'completed', label: 'Completed' },
                                    { id: 'draft', label: 'In Progress' },
                                    { id: 'error', label: 'Errors' }
                                ].map((filter) => {
                                    const isActive = historyFilter === filter.id;
                                    return (
                                        <button
                                            key={filter.id}
                                            onClick={() => setHistoryFilter(filter.id as FilterType)}
                                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${isActive
                                                ? 'bg-primary/20 border-primary/50 text-primary'
                                                : 'bg-surface/50 border-border/50 text-text-muted hover:border-primary/30'
                                                }`}
                                        >
                                            {filter.label}
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${isActive ? 'bg-primary/30' : 'bg-surface-lighter'
                                                }`}>
                                                {counts[filter.id as keyof typeof counts]}
                                            </span>
                                            {isActive && <Check className="w-3 h-3" />}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* History List */}
                            <div className="flex-1 overflow-y-auto p-6 space-y-3 custom-scrollbar">
                                {filteredHistory.length === 0 ? (
                                    <div className="text-text-muted text-sm italic py-20 flex flex-col items-center gap-4">
                                        <Clock className="w-12 h-12 opacity-10" />
                                        <span>
                                            {history.length === 0
                                                ? "No sessions found."
                                                : `No ${historyFilter === 'draft' ? 'in-progress' : historyFilter} sessions.`}
                                        </span>
                                        {history.length > 0 && historyFilter !== 'all' && (
                                            <button
                                                onClick={() => setHistoryFilter('all')}
                                                className="text-primary hover:underline font-normal not-italic"
                                            >
                                                View all instead
                                            </button>
                                        )}
                                    </div>
                                ) : (
                                    filteredHistory.map((entry) => (
                                        <div
                                            key={entry.id}
                                            className="relative group"
                                        >
                                            <button
                                                onClick={() => {
                                                    loadSession(entry.session_id);
                                                    onClose();
                                                }}
                                                className="w-full text-left p-4 rounded-xl bg-surface/50 border border-border hover:border-primary/50 hover:bg-surface/80 transition-all flex items-center justify-between group/item"
                                            >
                                                <div className="flex-1 min-w-0 pr-4">
                                                    <div className="flex justify-between items-start mb-1">
                                                        <span className="font-medium text-text-main truncate pr-2">{entry.filename}</span>
                                                        <div className="flex items-center gap-2 shrink-0">
                                                            {entry.status === 'completed' && <div className="w-2 h-2 rounded-full bg-green-500" title="Completed" />}
                                                            {entry.status === 'draft' && <div className="w-2 h-2 rounded-full bg-yellow-500" title="In Progress" />}
                                                            {entry.status === 'error' && <div className="w-2 h-2 rounded-full bg-red-500" title="Error" />}
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center justify-between text-xs text-text-muted">
                                                        <span className="truncate max-w-[200px]">{entry.deck}</span>
                                                        <span>{entry.card_count} cards • {new Date(entry.date).toLocaleDateString()}</span>
                                                    </div>
                                                </div>
                                                <ChevronRight className="w-5 h-5 text-text-muted opacity-0 group-hover/item:opacity-100 transition-opacity" />
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (confirm('Delete this history entry?')) {
                                                        deleteHistoryEntry(entry.id);
                                                    }
                                                }}
                                                className="absolute top-2 right-2 p-1.5 text-text-muted hover:text-red-400 hover:bg-surface rounded-md opacity-0 group-hover:opacity-100 transition-all"
                                                title="Delete Session"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>
                        </GlassCard>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
