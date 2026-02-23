import { motion } from 'framer-motion';
import { Sparkles, Monitor, FileText } from 'lucide-react';
import { clsx } from 'clsx';
import { GlassCard } from './GlassCard';
import { FilePicker } from './FilePicker';
import { useLecternStore } from '../store';

export function SourceMaterialCard() {
    const pdfFile = useLecternStore((s) => s.pdfFile);
    const setPdfFile = useLecternStore((s) => s.setPdfFile);
    const sourceType = useLecternStore((s) => s.sourceType);
    const setSourceType = useLecternStore((s) => s.setSourceType);

    return (
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
    );
}
