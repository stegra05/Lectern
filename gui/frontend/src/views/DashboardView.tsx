import { motion } from 'framer-motion';
import { Clock, Trash2, Plus, ChevronRight } from 'lucide-react';
import { GlassCard } from '../components/GlassCard';

import type { Step } from '../hooks/useAppState';
import type { HistoryEntry } from '../api';

interface DashboardViewProps {
    history: HistoryEntry[];
    clearAllHistory: () => void;
    deleteHistoryEntry: (id: string) => void;
    setDeckName: (name: string) => void;
    setPdfFile: (file: File | null) => void;
    setStep: (step: Step) => void;
    loadSession: (sessionId: string) => void;
}

export function DashboardView({
    history,
    clearAllHistory,
    deleteHistoryEntry,
    setDeckName,
    setPdfFile,
    setStep,
    loadSession,
}: DashboardViewProps) {
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

    return (
        <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="show"
            exit={{ opacity: 0, y: -20 }}
            className="grid grid-cols-1 lg:grid-cols-12 gap-8"
        >
            {/* Sidebar: Recent Files */}
            <motion.div variants={itemVariants} className="lg:col-span-4 space-y-6">
                <GlassCard className="h-full min-h-[500px] flex flex-col">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                            <Clock className="w-5 h-5 text-primary" />
                            <h2 className="text-lg font-semibold text-text-main">Recent Sessions</h2>
                        </div>
                        {history.length > 0 && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    clearAllHistory();
                                }}
                                className="text-xs text-text-muted hover:text-red-400 transition-colors flex items-center gap-1"
                            >
                                <Trash2 className="w-3 h-3" />
                                Clear All
                            </button>
                        )}
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-3 pr-2 -mr-2 scrollbar-thin scrollbar-thumb-border max-h-[60vh]">
                        {history.length === 0 ? (
                            <div className="text-text-muted text-sm italic text-center py-10">
                                No recent sessions found.
                            </div>
                        ) : (
                            history.map((entry) => (
                                <div
                                    key={entry.id}
                                    className="relative group"
                                >
                                    <button
                                        onClick={() => {
                                            loadSession(entry.session_id);
                                        }}
                                        className="w-full text-left p-4 rounded-xl bg-surface/50 border border-border hover:border-primary/50 hover:bg-surface transition-all"
                                    >
                                        <div className="flex justify-between items-start mb-2">
                                            <span className="font-medium text-text-main truncate w-full pr-6">{entry.filename}</span>
                                            {entry.status === 'completed' && <div className="w-2 h-2 rounded-full bg-green-500 mt-1.5 shrink-0" />}
                                            {entry.status === 'draft' && <div className="w-2 h-2 rounded-full bg-yellow-500 mt-1.5 shrink-0" />}
                                            {entry.status === 'error' && <div className="w-2 h-2 rounded-full bg-red-500 mt-1.5 shrink-0" />}
                                        </div>
                                        <div className="flex items-center justify-between text-xs text-text-muted">
                                            <span className="truncate max-w-[120px]">{entry.deck}</span>
                                            <span>{entry.card_count} cards</span>
                                        </div>
                                        <div className="mt-2 text-[10px] text-text-muted font-mono">
                                            {new Date(entry.date).toLocaleDateString()}
                                        </div>
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            deleteHistoryEntry(entry.id);
                                        }}
                                        className="absolute top-4 right-4 p-1.5 text-text-muted hover:text-red-400 hover:bg-surface rounded-md opacity-0 group-hover:opacity-100 transition-all"
                                        title="Delete Session"
                                    >
                                        <Trash2 className="w-3 h-3" />
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </GlassCard>
            </motion.div>

            {/* Main Area: New Generation */}
            <motion.div variants={itemVariants} className="lg:col-span-8">
                <GlassCard className="h-full flex flex-col justify-center items-center text-center p-12 border-primary/20 bg-primary/5 relative overflow-hidden group">
                    <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />

                    <div className="w-20 h-20 bg-primary/20 rounded-3xl flex items-center justify-center mb-8 text-primary shadow-[0_0_30px_rgba(0,0,0,0.2)] shadow-primary/20">
                        <Plus className="w-10 h-10" />
                    </div>

                    <h2 className="text-3xl font-bold text-text-main mb-4">Start New Generation</h2>
                    <p className="text-text-muted max-w-md mb-10 leading-relaxed">
                        Create a new Anki deck from your lecture slides. Lectern uses AI to extract concepts and generate high-quality cards.
                    </p>

                    <button
                        onClick={() => {
                            setDeckName('');
                            setPdfFile(null);
                            setStep('config');
                        }}
                        className="relative z-10 px-8 py-4 bg-primary hover:bg-primary/90 text-background rounded-xl font-bold text-lg shadow-lg shadow-primary/10 transition-all flex items-center gap-3"
                    >
                        Create New Deck
                        <ChevronRight className="w-5 h-5" />
                    </button>
                </GlassCard>
            </motion.div>
        </motion.div>
    );
};
