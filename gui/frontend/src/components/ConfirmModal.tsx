import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertTriangle } from 'lucide-react';
import { GlassCard } from './GlassCard';
import { clsx } from 'clsx';

interface ConfirmModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    description: React.ReactNode;
    confirmText?: string;
    cancelText?: string;
    variant?: 'default' | 'destructive';
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    title,
    description,
    confirmText = "Confirm",
    cancelText = "Cancel",
    variant = 'default'
}) => {
    if (!isOpen) return null;

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
                        onClick={onClose}
                    />
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        className="relative w-full max-w-md"
                    >
                        <GlassCard className="border-primary/20 shadow-2xl">
                            <button
                                onClick={onClose}
                                className="absolute top-4 right-4 p-1 text-text-muted hover:text-text-main transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>

                            <div className="mb-6">
                                <h3 className={clsx("text-lg font-bold flex items-center gap-2", {
                                    "text-text-main": variant === 'default',
                                    "text-red-400": variant === 'destructive'
                                })}>
                                    {variant === 'destructive' && <AlertTriangle className="w-5 h-5" />}
                                    {title}
                                </h3>
                                <div className="mt-2 text-sm text-text-muted leading-relaxed">
                                    {description}
                                </div>
                            </div>

                            <div className="flex justify-end gap-3">
                                <button
                                    onClick={onClose}
                                    className="px-4 py-2 text-sm font-medium text-text-muted hover:text-text-main hover:bg-surface rounded-lg transition-colors border border-transparent hover:border-border"
                                >
                                    {cancelText}
                                </button>
                                <button
                                    onClick={() => {
                                        onConfirm();
                                        onClose();
                                    }}
                                    className={clsx("px-4 py-2 text-sm font-bold rounded-lg transition-colors shadow-lg", {
                                        "bg-primary text-background hover:bg-primary/90 shadow-primary/20": variant === 'default',
                                        "bg-red-500 text-white hover:bg-red-600 shadow-red-500/20": variant === 'destructive'
                                    })}
                                >
                                    {confirmText}
                                </button>
                            </div>
                        </GlassCard>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};
