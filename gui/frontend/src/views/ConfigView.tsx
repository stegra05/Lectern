import React from 'react';
import { motion } from 'framer-motion';
import { RotateCcw, Play, Loader2, AlertCircle } from 'lucide-react';
import { clsx } from 'clsx';
import { GlassCard } from '../components/GlassCard';
import { FilePicker } from '../components/FilePicker';

import type { Step } from '../hooks/useAppState';

interface ConfigViewProps {
    pdfFile: File | null;
    setPdfFile: (file: File | null) => void;
    deckName: string;
    setDeckName: (name: string) => void;
    examMode: boolean;
    toggleExamMode: () => void;
    estimation: any;
    isEstimating: boolean;
    handleGenerate: () => void;
    setStep: (step: Step) => void;
    health: any;
}

export function ConfigView({
    pdfFile,
    setPdfFile,
    deckName,
    setDeckName,
    examMode,
    toggleExamMode,
    estimation,
    isEstimating,
    handleGenerate,
    setStep,
    health,
}: ConfigViewProps) {
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
            <motion.div variants={itemVariants} className="lg:col-span-12 mb-4">
                <button
                    onClick={() => setStep('dashboard')}
                    className="flex items-center gap-2 text-text-muted hover:text-text-main transition-colors text-sm font-medium"
                >
                    <RotateCcw className="w-4 h-4" /> Back to Dashboard
                </button>
            </motion.div>

            <motion.div variants={itemVariants} className="lg:col-span-7 space-y-8">
                <GlassCard className="space-y-6">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-semibold flex items-center gap-3">
                            <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-surface text-text-muted font-mono text-sm">01</span>
                            Source Material
                        </h2>
                    </div>
                    <FilePicker file={pdfFile} onFileSelect={setPdfFile} />
                </GlassCard>

                <GlassCard className="space-y-6">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-semibold flex items-center gap-3">
                            <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-surface text-text-muted font-mono text-sm">02</span>
                            Destination
                        </h2>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-text-muted mb-2 uppercase tracking-wider">Deck Name</label>
                        <input
                            type="text"
                            value={deckName}
                            onChange={(e) => setDeckName(e.target.value)}
                            placeholder="University::Subject::Topic"
                            className="w-full bg-surface/50 border border-border rounded-xl py-4 px-5 text-lg focus:ring-2 focus:ring-primary/50 focus:border-primary/50 outline-none transition-all placeholder:text-text-muted"
                        />
                    </div>

                    <div className="pt-4 border-t border-border/50">
                        <button
                            onClick={toggleExamMode}
                            className={clsx(
                                "w-full flex items-center justify-between p-4 rounded-xl border transition-all",
                                examMode
                                    ? "bg-primary/10 border-primary/30 hover:border-primary/50"
                                    : "bg-surface/30 border-border/50 hover:border-border"
                            )}
                        >
                            <div className="flex items-center gap-3">
                                <div className={clsx(
                                    "w-10 h-10 rounded-lg flex items-center justify-center text-lg",
                                    examMode ? "bg-primary/20 text-primary" : "bg-surface text-text-muted"
                                )}>
                                    🎯
                                </div>
                                <div className="text-left">
                                    <div className={clsx(
                                        "font-semibold",
                                        examMode ? "text-primary" : "text-text-main"
                                    )}>Exam Mode</div>
                                    <div className="text-xs text-text-muted">
                                        {examMode ? "Comparison & application cards" : "Standard card generation"}
                                    </div>
                                </div>
                            </div>
                            <div className={clsx(
                                "w-12 h-6 rounded-full p-1 transition-colors",
                                examMode ? "bg-primary" : "bg-surface"
                            )}>
                                <div className={clsx(
                                    "w-4 h-4 rounded-full bg-white shadow transition-transform",
                                    examMode ? "translate-x-6" : "translate-x-0"
                                )} />
                            </div>
                        </button>
                        {examMode && (
                            <p className="mt-2 text-xs text-primary/70 px-2">
                                🎓 Prioritizes understanding over memorization. 30% comparison, 25% application, 25% intuition, 20% definition cards.
                            </p>
                        )}
                    </div>
                </GlassCard>
            </motion.div>

            <motion.div variants={itemVariants} className="lg:col-span-5 flex flex-col justify-center">
                <div className="bg-surface/30 border border-border/50 rounded-3xl p-8 backdrop-blur-sm relative overflow-hidden group">
                    <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

                    <h3 className="text-2xl font-bold mb-4 text-text-main">Ready to Generate?</h3>
                    <p className="text-text-muted mb-8 leading-relaxed">
                        Lectern will analyze your slides, extract key concepts, and generate high-quality Anki cards using the configured Gemini model.
                    </p>

                    {(estimation || isEstimating) && (
                        <div className="mb-6 p-4 rounded-xl bg-surface/50 border border-border/50 flex items-center justify-between">
                            <div className="flex flex-col">
                                <span className="text-xs font-bold text-text-muted uppercase tracking-wider">Estimated Cost</span>
                                <div className="flex items-baseline gap-2 mt-1">
                                    {isEstimating ? (
                                        <div className="h-6 w-24 bg-surface animate-pulse rounded" />
                                    ) : (
                                        <>
                                            <span className="text-xl font-bold text-text-main">
                                                ${estimation?.cost.toFixed(2)}
                                            </span>
                                            <span className="text-sm text-text-muted font-mono">
                                                (~{(estimation?.tokens! / 1000).toFixed(1)}k tokens)
                                            </span>
                                        </>
                                    )}
                                </div>
                            </div>
                            {isEstimating && <Loader2 className="w-4 h-4 text-text-muted animate-spin" />}
                        </div>
                    )}

                    <button
                        onClick={handleGenerate}
                        disabled={!pdfFile || !deckName || !health?.anki_connected}
                        className="w-full group relative px-8 py-5 bg-primary hover:bg-primary/90 text-background rounded-xl font-bold text-lg shadow-lg shadow-primary/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none overflow-hidden"
                    >
                        <span className="relative z-10 flex items-center justify-center gap-3">
                            <Play className="w-5 h-5 fill-current" />
                            Start Generation
                        </span>
                    </button>

                    {!health?.anki_connected && (
                        <div className="mt-4 flex items-center gap-2 text-red-400 text-sm bg-red-500/10 p-3 rounded-lg border border-red-500/20">
                            <AlertCircle className="w-4 h-4" />
                            <span>Anki is not connected. Please start Anki.</span>
                        </div>
                    )}
                </div>
            </motion.div>
        </motion.div>
    );
}
