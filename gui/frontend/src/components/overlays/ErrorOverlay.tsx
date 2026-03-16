import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { GlassCard } from '../GlassCard';
import { findLastError } from '../../utils/cards';
import type { ProgressEvent } from '../../api';
import { type FriendlyError, translateError } from '../../utils/errorMessages';

interface ErrorOverlayProps {
    /** Whether an error occurred */
    isError: boolean;
    /** Output logs */
    logs: ProgressEvent[];
    /** Whether logs have been copied */
    copied: boolean;
    /** Callback to copy logs */
    onCopyLogs: () => void;
    /** Callback to reset generation */
    onReset: () => void;
    /** Content to render behind the error overlay (blurred) */
    children: React.ReactNode;
}

/**
 * ErrorOverlay displays when a generation error occurs.
 *
 * This component is pure and relays on props.
 */
export function ErrorOverlay({ isError, logs, copied, onCopyLogs, onReset, children }: ErrorOverlayProps) {

    const lastError = useMemo(() => findLastError(logs, isError), [isError, logs]);

    if (!isError) {
        return <>{children}</>;
    }

    const friendlyError: FriendlyError = translateError(lastError, 'generation');

    return (
        <div className="relative">
            <div className="filter blur-sm pointer-events-none opacity-50">
                {children}
            </div>

            <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            >
                <GlassCard className="max-w-md w-full border-red-500/30 bg-red-950/20 shadow-[0_0_40px_rgba(239,68,68,0.2)]">
                    <div className="flex flex-col items-center text-center p-4">
                        <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mb-4 border border-red-500/20">
                            <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </div>

                        <h2 className="text-xl font-bold text-red-200 mb-2">{friendlyError.title}</h2>

                        <p className="text-sm text-text-muted mb-4">
                            {friendlyError.message}
                        </p>

                        {friendlyError.action && (
                            <p className="text-sm text-primary mb-4">
                                {friendlyError.action}
                            </p>
                        )}

                        {friendlyError.errorCode && (
                            <div className="bg-red-950/40 p-2 rounded-lg border border-red-500/10 w-full mb-4">
                                <p className="text-[10px] font-mono text-red-300/60 break-words text-center">
                                    Error code: {friendlyError.errorCode}
                                </p>
                            </div>
                        )}

                        <div className="flex gap-3 w-full">
                            <button
                                onClick={onCopyLogs}
                                className="flex-1 py-2 px-4 rounded-lg border border-border bg-surface hover:bg-surface/80 text-text-muted hover:text-text-main transition-colors text-sm font-medium"
                            >
                                {copied ? "Copied Logs" : "Copy Logs"}
                            </button>
                            <button
                                onClick={onReset}
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
