import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmDialogProps {
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'danger' | 'warning' | 'primary';
    onConfirm: () => void;
    onCancel: () => void;
}

export function ConfirmDialog({
    isOpen,
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    variant = 'danger',
    onConfirm,
    onCancel,
}: ConfirmDialogProps) {
    const variantStyles = {
        danger: {
            button: 'bg-red-500 hover:bg-red-600 text-white',
            icon: 'text-red-400',
        },
        warning: {
            button: 'bg-amber-500 hover:bg-amber-600 text-white',
            icon: 'text-amber-400',
        },
        primary: {
            button: 'bg-primary hover:bg-primary/90 text-background',
            icon: 'text-primary',
        },
    };

    const styles = variantStyles[variant];

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onCancel}
                        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
                    />
                    {/* Modal */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none p-4"
                    >
                        <div className="bg-surface border border-border w-full max-w-md rounded-2xl shadow-2xl pointer-events-auto overflow-hidden">
                            {/* Header */}
                            <div className="p-5 border-b border-border flex items-start justify-between">
                                <div className="flex items-center gap-3">
                                    <div className={`p-2 rounded-lg bg-surface/50 ${styles.icon}`}>
                                        <AlertTriangle className="w-5 h-5" />
                                    </div>
                                    <h2 className="text-lg font-semibold text-text-main">{title}</h2>
                                </div>
                                <button
                                    onClick={onCancel}
                                    aria-label="Close dialog"
                                    className="p-1.5 hover:bg-background rounded-lg text-text-muted hover:text-text-main transition-colors"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>

                            {/* Content */}
                            <div className="p-5">
                                <p className="text-sm text-text-muted leading-relaxed">{message}</p>
                            </div>

                            {/* Footer */}
                            <div className="p-4 border-t border-border bg-surface/30 flex items-center justify-end gap-3">
                                <button
                                    onClick={onCancel}
                                    className="px-4 py-2 bg-surface hover:bg-background border border-border rounded-lg text-sm font-medium text-text-main transition-colors"
                                >
                                    {cancelLabel}
                                </button>
                                <button
                                    onClick={onConfirm}
                                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${styles.button}`}
                                >
                                    {confirmLabel}
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
