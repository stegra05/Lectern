import { useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { GlassCard } from '../GlassCard';
import type { ProgressEvent } from '../../api';

export interface SyncOverlayProps {
    syncProgress: { current: number; total: number };
    syncLogs: ProgressEvent[];
    cardCount: number;
}

/**
 * SyncOverlay displays progress during Anki sync operations.
 *
 * This component is pure and displays sync progress based on provided props.
 */
export function SyncOverlay({ syncProgress, syncLogs, cardCount }: SyncOverlayProps) {

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
                                Exporting {cardCount} cards to your collection
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
                    {syncLogs.map((log: ProgressEvent, i: number) => (
                        <motion.div
                            key={i}
                            initial={{ opacity: 0, x: -5 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="text-text-muted"
                        >
                            <span className="opacity-50 mr-2">{new Date(log.timestamp).toLocaleTimeString().split(' ')[0]}</span>
                            {log.message}
                        </motion.div>
                    ))}
                    <div ref={logsEndRef} />
                </GlassCard>
            </div>
        </div>
    );
}
