import { motion } from 'framer-motion';
import { Play, Loader2, AlertCircle, Sparkles, Monitor, FileText, Info } from 'lucide-react';
import { clsx } from 'clsx';
import { GlassCard } from '../components/GlassCard';
import { FilePicker } from '../components/FilePicker';
import { DeckSelector } from '../components/DeckSelector';
import { computeDensitySummary } from '../utils/density';

import type { HealthStatus } from '../hooks/useAppState';
import type { Estimation } from '../api';

interface HomeViewProps {
    pdfFile: File | null;
    setPdfFile: (file: File | null) => void;
    deckName: string;
    setDeckName: (name: string) => void;
    focusPrompt: string;
    setFocusPrompt: (prompt: string) => void;
    sourceType: 'auto' | 'slides' | 'script';
    setSourceType: (type: 'auto' | 'slides' | 'script') => void;
    densityTarget: number;
    setDensityTarget: (target: number) => void;
    estimation: Estimation | null;
    isEstimating: boolean;
    handleGenerate: () => void;
    health: HealthStatus | null;
}

export function HomeView({
    pdfFile,
    setPdfFile,
    deckName,
    setDeckName,
    focusPrompt,
    setFocusPrompt,
    sourceType,
    setSourceType,
    densityTarget,
    setDensityTarget,
    estimation,
    isEstimating,
    handleGenerate,
    health,
}: HomeViewProps) {
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

    const pageCount = estimation?.pages || 0;
    const densitySummary = computeDensitySummary(densityTarget, sourceType, pageCount);

    return (
        <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="show"
            exit={{ opacity: 0, y: -20 }}
            className="grid grid-cols-1 lg:grid-cols-12 gap-8"
        >
            {/* LEFT COLUMN: Source & Configuration */}
            <motion.div variants={itemVariants} className="lg:col-span-7 space-y-8">
                <GlassCard className="space-y-6">
                    <div className="flex items-center gap-3">
                        <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-surface text-text-muted font-mono text-sm">01</span>
                        <h2 className="text-xl font-semibold">Source Material</h2>
                    </div>
                    <FilePicker file={pdfFile} onFileSelect={setPdfFile} />

                    <div className={clsx("space-y-4 transition-all duration-500", !pdfFile && "opacity-40 grayscale pointer-events-none")}>
                        <label className="block text-xs font-bold text-text-muted uppercase tracking-wider">Document Context</label>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            {[
                                { id: 'auto', label: 'Auto Detect', icon: Sparkles, desc: 'Mixed content' },
                                { id: 'slides', label: 'Slides', icon: Monitor, desc: 'Visual heavy' },
                                { id: 'script', label: 'Script', icon: FileText, desc: 'Text dense' },
                            ].map((type) => (
                                <button
                                    key={type.id}
                                    onClick={() => setSourceType(type.id as 'auto' | 'slides' | 'script')}
                                    className={clsx(
                                        "relative flex flex-col items-start p-4 rounded-xl border transition-all duration-200 text-left",
                                        sourceType === type.id
                                            ? "bg-primary/10 border-primary/40 shadow-sm"
                                            : "bg-surface/30 border-border/50 text-text-muted hover:border-border"
                                    )}
                                >
                                    <div className={clsx(
                                        "p-2 rounded-lg mb-3",
                                        sourceType === type.id ? "bg-primary text-background" : "bg-surface text-text-muted"
                                    )}>
                                        <type.icon className="w-4 h-4" />
                                    </div>
                                    <span className={clsx("font-medium text-sm", sourceType === type.id ? "text-primary" : "text-text-main")}>
                                        {type.label}
                                    </span>
                                    <span className="text-[10px] text-text-muted mt-0.5">{type.desc}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </GlassCard>

                <GlassCard className="space-y-6">
                    <div className="flex items-center gap-3">
                        <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-surface text-text-muted font-mono text-sm">02</span>
                        <h2 className="text-xl font-semibold">Configuration</h2>
                    </div>

                    <div className="space-y-6">
                        <div>
                            <label className="block text-sm font-medium text-text-muted mb-2 uppercase tracking-wider">Target Deck</label>
                            <DeckSelector
                                value={deckName}
                                onChange={setDeckName}
                                disabled={!health?.anki_connected}
                            />
                        </div>

                        <div className="pt-4 border-t border-border/30">
                            <div className="flex justify-between items-end mb-4">
                                <label className="text-sm font-medium text-text-muted uppercase tracking-wider">Density & Detail</label>
                                <div className="text-right">
                                    <span className="text-xl font-bold text-primary">{densityTarget}</span>
                                    <span className="text-xs text-text-muted ml-1">/ 5.0</span>
                                </div>
                            </div>

                            <div className="flex items-center gap-4">
                                <input
                                    type="range"
                                    min="0.1"
                                    max="5.0"
                                    step="0.1"
                                    value={densityTarget}
                                    onChange={(e) => setDensityTarget(parseFloat(e.target.value))}
                                    className="flex-1 h-1.5 bg-surface rounded-lg appearance-none cursor-pointer accent-primary"
                                />
                                <input
                                    type="number"
                                    min="0.1"
                                    max="5.0"
                                    step="0.1"
                                    value={densityTarget}
                                    onChange={(e) => {
                                        const val = parseFloat(e.target.value);
                                        if (!isNaN(val)) setDensityTarget(val);
                                    }}
                                    className="w-14 bg-surface/50 border border-border rounded-lg py-1 text-center text-sm outline-none focus:ring-1 focus:ring-primary/50"
                                />
                            </div>
                            <div className="flex justify-between text-[10px] text-text-muted mt-2 px-1 font-medium">
                                <span>CONCISE</span>
                                <span>BALANCED</span>
                                <span>COMPREHENSIVE</span>
                            </div>

                            <div className="mt-4 p-3 rounded-lg bg-surface/30 border border-border/30 flex items-start gap-3">
                                <Info className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                                <div className="text-xs text-text-muted leading-relaxed">
                                    {densitySummary.mode === 'script' ? (
                                        <>
                                            <div className="flex justify-between items-center mb-1">
                                                <span className="font-bold text-primary">
                                                    Extraction Granularity: {densitySummary.ratio}x
                                                </span>
                                                {estimation?.estimated_card_count !== undefined && (
                                                    <span className="px-2 py-0.5 rounded bg-primary/20 text-primary text-[10px] font-bold">
                                                        EST. {estimation.estimated_card_count} TOTAL CARDS
                                                    </span>
                                                )}
                                            </div>
                                            <span>
                                                Controls how "deep" the AI digs. At <b>1.0x (Balanced)</b>, it targets
                                                core concepts. Higher values force the AI to extract more nuanced details
                                                (paragraph-level resolution), while lower values stick to high-level
                                                summaries.{' '}
                                                {estimation?.estimated_card_count !== undefined
                                                    ? 'Final card estimate comes from backend content analysis.'
                                                    : 'Run estimation to see a backend card count.'}
                                            </span>
                                        </>
                                    ) : (
                                        <>
                                            <div className="flex justify-between items-center mb-1">
                                                <span className="font-bold text-primary">
                                                    Target: ~{densitySummary.targetPerSlide} cards per active slide
                                                </span>
                                                {estimation?.estimated_card_count !== undefined && (
                                                    <span className="px-2 py-0.5 rounded bg-primary/20 text-primary text-[10px] font-bold">
                                                        EST. {estimation.estimated_card_count} TOTAL CARDS
                                                    </span>
                                                )}
                                            </div>
                                            <span>
                                                Heuristic goal for the AI.{' '}
                                                {estimation?.estimated_card_count !== undefined
                                                    ? 'Final card estimate comes from backend content analysis.'
                                                    : 'Run estimation to see a backend card count.'}
                                            </span>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="pt-4 border-t border-border/30">
                            <label className="block text-sm font-medium text-text-muted mb-2 uppercase tracking-wider">Focus Guidance (Optional)</label>
                            <textarea
                                value={focusPrompt}
                                onChange={(e) => setFocusPrompt(e.target.value)}
                                placeholder="E.g. 'Focus on clinical formulas' or 'Prioritize case studies'"
                                className="w-full bg-surface/50 border border-border rounded-xl p-4 text-sm min-h-[100px] outline-none transition-all focus:ring-2 focus:ring-primary/50 placeholder:text-text-muted resize-none leading-relaxed"
                            />
                        </div>
                    </div>
                </GlassCard>
            </motion.div>

            {/* RIGHT COLUMN: Summary & Action */}
            <motion.div variants={itemVariants} className="lg:col-span-5">
                <div className="sticky top-24 space-y-6">
                    <GlassCard className="relative overflow-hidden group border-primary/10">
                        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />

                        <h3 className="text-2xl font-bold mb-4 text-text-main">Generation Summary</h3>

                        <div className="space-y-4 mb-8">
                            <div className="flex items-center gap-3 text-sm">
                                <div className={clsx("w-2 h-2 rounded-full", pdfFile ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" : "bg-red-500")} />
                                <span className="text-text-muted">Source:</span>
                                <span className="font-medium truncate flex-1">{pdfFile?.name || 'No file selected'}</span>
                            </div>
                            <div className="flex items-center gap-3 text-sm">
                                <div className={clsx("w-2 h-2 rounded-full", deckName ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" : "bg-red-500")} />
                                <span className="text-text-muted">Deck:</span>
                                <span className="font-medium truncate flex-1">{deckName || 'No deck selected'}</span>
                            </div>
                            <div className="flex items-center gap-3 text-sm">
                                <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
                                <span className="text-text-muted">Settings:</span>
                                <span className="font-medium capitalize">{sourceType} • {densityTarget >= 3.5 ? 'Comprehensive' : densityTarget <= 1.5 ? 'Concise' : 'Balanced'}</span>
                            </div>
                        </div>

                        {(estimation || isEstimating) && (
                            <div className="mb-8 space-y-3">
                                <div className="p-4 rounded-xl bg-surface/30 border border-border/50">
                                    <div className="flex items-center justify-between mb-3 border-b border-border/30 pb-2">
                                        <div className="flex flex-col">
                                            <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Estimated Total</span>
                                            {isEstimating ? (
                                                <div className="h-7 w-20 bg-surface animate-pulse rounded mt-1" />
                                            ) : (
                                                <div className="flex flex-col">
                                                    {estimation?.estimated_card_count !== undefined && (
                                                        <span className="text-xs text-text-muted">
                                                            ~{estimation.estimated_card_count} cards
                                                        </span>
                                                    )}
                                                    <span className="text-2xl font-bold text-primary">${estimation?.cost.toFixed(3)}</span>
                                                </div>
                                            )}
                                        </div>
                                        {!isEstimating && (
                                            <div className="text-right">
                                                <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider block">Model</span>
                                                <span className="text-xs font-mono text-text-main">{estimation?.model.split('/').pop()}</span>
                                            </div>
                                        )}
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1">
                                            <span className="text-[9px] font-bold text-text-muted uppercase">Input</span>
                                            <div className="flex items-baseline gap-1">
                                                {isEstimating ? (
                                                    <div className="h-4 w-12 bg-surface animate-pulse rounded" />
                                                ) : (
                                                    <>
                                                        <span className="text-sm font-semibold text-text-main">
                                                            {((estimation?.input_tokens ?? 0) / 1000).toFixed(1)}k
                                                        </span>
                                                        <span className="text-[9px] text-text-muted">tokens</span>
                                                    </>
                                                )}
                                            </div>
                                            {!isEstimating && (
                                                <div className="text-[10px] text-text-muted font-mono">${estimation?.input_cost.toFixed(4)}</div>
                                            )}
                                        </div>
                                        <div className="space-y-1">
                                            <span className="text-[9px] font-bold text-text-muted uppercase">Output (Est.)</span>
                                            <div className="flex items-baseline gap-1">
                                                {isEstimating ? (
                                                    <div className="h-4 w-12 bg-surface animate-pulse rounded" />
                                                ) : (
                                                    <>
                                                        <span className="text-sm font-semibold text-text-main">
                                                            {((estimation?.output_tokens ?? 0) / 1000).toFixed(1)}k
                                                        </span>
                                                        <span className="text-[9px] text-text-muted">tokens</span>
                                                    </>
                                                )}
                                            </div>
                                            {!isEstimating && (
                                                <div className="text-[10px] text-text-muted font-mono">${estimation?.output_cost.toFixed(4)}</div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                {isEstimating && (
                                    <div className="flex items-center justify-center gap-2 py-2 text-xs text-primary animate-pulse">
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                        <span>Analyzing content density...</span>
                                    </div>
                                )}
                            </div>
                        )}

                        <button
                            onClick={handleGenerate}
                            disabled={!pdfFile || !deckName || !health?.anki_connected || isEstimating}
                            className="w-full relative group px-8 py-5 bg-primary hover:bg-primary/90 text-background rounded-xl font-bold text-lg shadow-lg shadow-primary/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none overflow-hidden"
                        >
                            <span className="relative z-10 flex items-center justify-center gap-3">
                                <Play className="w-5 h-5 fill-current" />
                                Start Generation
                            </span>
                        </button>

                        {!health?.anki_connected && (
                            <div className="mt-4 flex items-center gap-2 text-red-400 text-xs bg-red-500/5 p-3 rounded-lg border border-red-500/10">
                                <AlertCircle className="w-4 h-4" />
                                <span>Anki is not connected. Please start Anki.</span>
                            </div>
                        )}
                    </GlassCard>
                </div>
            </motion.div>
        </motion.div>
    );
}
