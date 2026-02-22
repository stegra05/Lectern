import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, X, CheckSquare } from 'lucide-react';
import { clsx } from 'clsx';

interface BatchActionBarProps {
    selectedCount: number;
    onDelete: () => void;
    onClear: () => void;
    onExit: () => void;
}

export const BatchActionBar: React.FC<BatchActionBarProps> = ({
    selectedCount,
    onDelete,
    onClear,
    onExit,
}) => {
    return (
        <AnimatePresence>
            {selectedCount > 0 && (
                <motion.div
                    initial={{ y: 100, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 100, opacity: 0 }}
                    transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                    className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
                >
                    <div className={clsx(
                        "flex items-center gap-4 px-6 py-3 rounded-2xl",
                        "bg-surface/80 backdrop-blur-xl border border-border/50",
                        "shadow-2xl shadow-black/20"
                    )}>
                        {/* Selection count */}
                        <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center">
                                <CheckSquare className="w-3.5 h-3.5 text-primary" />
                            </div>
                            <span className="text-sm font-medium text-text-main">
                                <span className="font-bold text-primary">{selectedCount}</span>
                                <span className="text-text-muted ml-1">
                                    card{selectedCount !== 1 ? 's' : ''} selected
                                </span>
                            </span>
                        </div>

                        <div className="w-px h-6 bg-border" />

                        {/* Action buttons */}
                        <div className="flex items-center gap-2">
                            <button
                                onClick={onDelete}
                                className={clsx(
                                    "flex items-center gap-2 px-4 py-2 rounded-lg",
                                    "bg-red-500/10 hover:bg-red-500/20 border border-red-500/30",
                                    "text-red-400 hover:text-red-300",
                                    "font-medium text-sm transition-all",
                                    "active:scale-95"
                                )}
                            >
                                <Trash2 className="w-4 h-4" />
                                Delete
                            </button>
                            <button
                                onClick={onClear}
                                className={clsx(
                                    "flex items-center gap-2 px-3 py-2 rounded-lg",
                                    "bg-surface hover:bg-background",
                                    "border border-border hover:border-border/80",
                                    "text-text-muted hover:text-text-main",
                                    "text-sm transition-all",
                                    "active:scale-95"
                                )}
                            >
                                <X className="w-4 h-4" />
                                Clear
                            </button>
                            <button
                                onClick={onExit}
                                className={clsx(
                                    "px-3 py-2 rounded-lg",
                                    "text-text-muted hover:text-text-main",
                                    "text-sm transition-colors",
                                    "hover:bg-surface"
                                )}
                            >
                                Exit
                            </button>
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
