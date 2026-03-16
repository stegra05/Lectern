import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { GlassCard } from '../GlassCard';
import type { ProgressEvent } from '../../api';

interface SyncPartialFailureOverlayProps {
    /** Optional partial failure details */
    syncPartialFailure: { failed: number; created: number } | null;
    /** Sync logs to extract failure details */
    syncLogs: ProgressEvent[];
    /** Callback when user dismisses the overlay */
    onDismiss: () => void;
}

/**
 * SyncPartialFailureOverlay displays when sync completes with some failures.
 *
 * This component is pure and relies on props.
 */
export function SyncPartialFailureOverlay({ syncPartialFailure, syncLogs, onDismiss }: SyncPartialFailureOverlayProps) {
    const [copied, setCopied] = useState(false);

    // Derive data from state (hooks must be called before any early returns)
    const { failed, created } = syncPartialFailure ?? { failed: 0, created: 0 };

    const failureLogs = syncLogs.filter(
        (log: ProgressEvent) => log.type === 'warning' || log.type === 'error'
    );

    const handleCopyLogs = useCallback(() => {
        const text = syncLogs
            .map(
                (log: ProgressEvent) =>
                    `[${new Date(log.timestamp).toLocaleTimeString()}] ${log.type.toUpperCase()}: ${log.message}`
            )
            .join('\n');
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, [syncLogs]);

    // If no partial failure, don't render (after all hooks are called)
    if (!syncPartialFailure) {
        return null;
    }

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
                        {created} card{created !== 1 ? 's' : ''} synced, {failed} failed
                    </p>

                    {failureLogs.length > 0 && (
                        <div className="bg-yellow-950/40 p-3 rounded-lg border border-yellow-500/10 w-full mb-4 max-h-32 overflow-y-auto">
                            <div className="space-y-1 text-left">
                                {failureLogs.slice(0, 5).map((log: ProgressEvent, i: number) => (
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
