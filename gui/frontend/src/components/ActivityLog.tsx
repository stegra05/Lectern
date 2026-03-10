import { memo, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Terminal, Copy, Check, Loader2, Download } from 'lucide-react';
import { clsx } from 'clsx';
import type { ProgressEvent } from '../api';

interface ActivityLogProps {
    logs: ProgressEvent[];
    copied: boolean;
    onCopyLogs: () => void;
    onExportLogs?: () => void;
    isCancelling: boolean;
    onCancel: () => void;
    isHistorical: boolean;
    sessionId: string | null;
    variant?: 'generating' | 'done';
}

/**
 * Activity log component for displaying generation/sync logs.
 * Memoized to prevent re-renders when unrelated state changes.
 */
export const ActivityLog = memo(function ActivityLog({
    logs,
    copied,
    onCopyLogs,
    onExportLogs,
    isCancelling,
    onCancel,
    isHistorical,
    sessionId,
    variant = 'generating',
}: ActivityLogProps) {
    const logsEndRef = useRef<HTMLDivElement>(null);

    // Auto-scroll logs
    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs.length]);

    if (variant === 'done') {
        return (
            <div className="bg-background rounded-lg p-3 font-mono text-[11px] h-40 overflow-y-auto border border-border scrollbar-thin scrollbar-thumb-border">
                <div className="space-y-1.5">
                    {logs.map((log, i) => (
                        <div
                            key={i}
                            className={clsx("flex gap-2", {
                                "text-blue-400": log.type === 'info',
                                "text-yellow-400": log.type === 'warning',
                                "text-red-400": log.type === 'error',
                                "text-primary": log.type === 'note_created',
                                "text-text-muted": log.type === 'status',
                                "text-primary font-bold": log.type === 'step_start',
                            })}
                        >
                            <span className="opacity-30 shrink-0 text-text-muted">
                                {new Date(log.timestamp).toLocaleTimeString().split(' ')[0]}
                            </span>
                            <span className="break-words">{log.message}</span>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col min-h-0 p-4">
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <Terminal className="w-3.5 h-3.5 text-text-muted" />
                    <h2 className="text-xs font-bold uppercase tracking-wider text-text-muted">
                        Activity Log
                        {isHistorical && sessionId && (
                            <span className="ml-1 font-mono opacity-60">#{sessionId.slice(0, 8)}</span>
                        )}
                    </h2>
                </div>
                <div className="flex items-center gap-2">
                    {logs.length > 0 && (
                        <>
                            {onExportLogs && (
                                <button
                                    onClick={onExportLogs}
                                    className="p-1 text-text-muted hover:text-primary transition-colors rounded"
                                    title="Export logs"
                                >
                                    <Download className="w-3.5 h-3.5" />
                                </button>
                            )}
                            <button
                                onClick={onCopyLogs}
                                className="p-1 text-text-muted hover:text-primary transition-colors rounded"
                                title="Copy logs"
                            >
                                {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                        </>
                    )}
                </div>
            </div>

            <div className="bg-background rounded-lg p-3 font-mono text-[11px] flex-1 overflow-y-auto border border-border min-h-0 scrollbar-thin scrollbar-thumb-border">
                {/* Status header */}
                <div className="flex items-center justify-between mb-2 border-b border-border pb-2">
                    <span className="flex items-center gap-1.5 text-primary/70">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                        <span className="font-bold text-[10px] tracking-wide">PROCESSING</span>
                    </span>
                    {isCancelling ? (
                        <div className="flex items-center gap-1.5 text-red-400 text-[10px]">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            <span className="font-bold tracking-wide">CANCELLING...</span>
                        </div>
                    ) : (
                        <button
                            onClick={onCancel}
                            className="text-[10px] text-red-400 hover:text-red-300 border border-red-900/50 bg-red-900/20 px-2 py-0.5 rounded font-bold"
                        >
                            CANCEL
                        </button>
                    )}
                </div>

                {/* Log entries */}
                <div className="space-y-1.5">
                    {logs.map((log, i) => (
                        <motion.div
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            key={i}
                            className={clsx("flex gap-2", {
                                "text-blue-400": log.type === 'info',
                                "text-yellow-400": log.type === 'warning',
                                "text-red-400": log.type === 'error',
                                "text-primary": log.type === 'note_created',
                                "text-text-muted": log.type === 'status',
                                "text-primary font-bold": log.type === 'step_start',
                            })}
                        >
                            <span className="opacity-30 shrink-0 text-text-muted">
                                {new Date(log.timestamp).toLocaleTimeString().split(' ')[0]}
                            </span>
                            <span className="break-words">{log.message}</span>
                        </motion.div>
                    ))}
                    <div ref={logsEndRef} />
                </div>
            </div>
        </div>
    );
});
