import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Trash2, Edit2, ChevronLeft, ChevronRight, X, Keyboard, Info } from 'lucide-react';
import type { Card } from '../api';

interface FocusModeProps {
    cards: Card[];
    onClose: () => void;
    onDelete: (index: number) => void;
    onEdit: (index: number) => void;
    onSync: () => void;
}

export const FocusMode: React.FC<FocusModeProps> = ({
    cards,
    onClose,
    onDelete,
    onEdit,
    onSync,
}) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [direction, setDirection] = useState(0); // -1 for left, 1 for right

    const currentCard = cards[currentIndex];

    const handleNext = useCallback(() => {
        if (currentIndex < cards.length - 1) {
            setDirection(1);
            setCurrentIndex(prev => prev + 1);
        }
    }, [currentIndex, cards.length]);

    const handlePrev = useCallback(() => {
        if (currentIndex > 0) {
            setDirection(-1);
            setCurrentIndex(prev => prev - 1);
        }
    }, [currentIndex]);

    const handleDelete = useCallback(() => {
        onDelete(currentIndex);
        // If we delete the last card, move back
        if (currentIndex >= cards.length - 1 && currentIndex > 0) {
            setCurrentIndex(prev => prev - 1);
        }
    }, [currentIndex, onDelete, cards.length]);

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'ArrowRight' || e.key === ' ') {
                e.preventDefault();
                handleNext();
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                handlePrev();
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                handleDelete();
            } else if (e.key === 'e' || e.key === 'E') {
                e.preventDefault();
                onEdit(currentIndex);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleNext, handlePrev, handleDelete, onEdit, onClose, currentIndex]);

    if (!currentCard) {
        return (
            <div className="fixed inset-0 z-[100] bg-background flex flex-col items-center justify-center p-8">
                <h2 className="text-2xl font-bold mb-4">No cards to review</h2>
                <button onClick={onClose} className="px-6 py-2 bg-surface border border-border rounded-lg">Return</button>
            </div>
        );
    }

    const variants = {
        enter: (direction: number) => ({
            x: direction > 0 ? 300 : -300,
            opacity: 0,
            scale: 0.9,
        }),
        center: {
            zIndex: 1,
            x: 0,
            opacity: 1,
            scale: 1,
        },
        exit: (direction: number) => ({
            zIndex: 0,
            x: direction < 0 ? 300 : -300,
            opacity: 0,
            scale: 0.9,
        }),
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-background/95 backdrop-blur-xl flex flex-col"
        >
            {/* Header */}
            <div className="flex items-center justify-between px-8 py-6 border-b border-border/50">
                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20">
                            <Check className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold">Focus Review</h2>
                            <p className="text-xs text-text-muted">Triage your cards with speed</p>
                        </div>
                    </div>
                    <div className="h-8 w-px bg-border/50" />
                    <div className="flex items-center gap-1.5 px-3 py-1 bg-surface rounded-full border border-border text-xs font-mono">
                        <span className="text-primary font-bold">{currentIndex + 1}</span>
                        <span className="text-text-muted">/</span>
                        <span>{cards.length}</span>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <div className="hidden md:flex items-center gap-4 mr-4 px-4 py-2 bg-surface/50 rounded-xl border border-border/50">
                        <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
                            <kbd className="px-1.5 py-0.5 bg-background border border-border rounded text-text-main font-mono">Space</kbd> Next
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
                            <kbd className="px-1.5 py-0.5 bg-background border border-border rounded text-text-main font-mono">Del</kbd> Remove
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
                            <kbd className="px-1.5 py-0.5 bg-background border border-border rounded text-text-main font-mono">E</kbd> Edit
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-surface rounded-xl border border-transparent hover:border-border transition-all"
                    >
                        <X className="w-6 h-6 text-text-muted" />
                    </button>
                </div>
            </div>

            {/* Main Content: Card Carousel */}
            <div className="flex-1 relative flex items-center justify-center overflow-hidden p-8">
                {/* Navigation Buttons */}
                <button
                    onClick={handlePrev}
                    disabled={currentIndex === 0}
                    className="absolute left-8 z-10 p-4 bg-surface/50 border border-border rounded-full hover:bg-surface disabled:opacity-0 transition-all"
                >
                    <ChevronLeft className="w-8 h-8" />
                </button>

                <div className="w-full max-w-3xl aspect-[4/3] max-h-[70vh]">
                    <AnimatePresence initial={false} custom={direction}>
                        <motion.div
                            key={currentIndex}
                            custom={direction}
                            variants={variants}
                            initial="enter"
                            animate="center"
                            exit="exit"
                            transition={{
                                x: { type: "spring", stiffness: 300, damping: 30 },
                                opacity: { duration: 0.2 },
                            }}
                            className="absolute inset-0 bg-surface border border-border rounded-3xl shadow-2xl overflow-hidden flex flex-col"
                        >
                            {/* Card Header Info */}
                            <div className="px-8 py-4 border-b border-border/50 bg-background/20 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <span className="px-2 py-0.5 bg-primary/10 border border-primary/20 rounded text-[10px] font-bold text-primary uppercase tracking-widest">
                                        {currentCard.model_name || 'Basic'}
                                    </span>
                                    {currentCard.slide_topic && (
                                        <span className="text-xs text-text-muted font-medium truncate max-w-[300px]">
                                            {currentCard.slide_topic}
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-1.5 px-2 py-0.5 bg-background/50 rounded border border-border text-[10px] font-mono text-text-muted">
                                    SLIDE {currentCard.slide_topic?.match(/Slide (\d+)/)?.[1] || '?'}
                                </div>
                            </div>

                            {/* Card Content */}
                            <div className="flex-1 overflow-y-auto px-12 pt-16 pb-12 space-y-8 scrollbar-thin scrollbar-thumb-border">
                                {Object.entries(currentCard.fields || {}).map(([key, value]) => (
                                    <div key={key}>
                                        <div className="text-[10px] font-bold text-text-muted uppercase tracking-[0.2em] mb-3 opacity-50">{key}</div>
                                        <div
                                            className="text-2xl text-text-main leading-relaxed prose prose-invert max-w-none font-medium"
                                            dangerouslySetInnerHTML={{ __html: String(value) }}
                                        />
                                    </div>
                                ))}
                            </div>

                            {/* Card Footer Actions */}
                            <div className="p-8 border-t border-border/50 bg-background/20 flex items-center justify-center gap-4">
                                <button
                                    onClick={handleDelete}
                                    className="flex items-center gap-2 px-6 py-3 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-2xl transition-all"
                                >
                                    <Trash2 className="w-5 h-5" />
                                    <span className="font-bold">Discard</span>
                                </button>
                                <button
                                    onClick={() => onEdit(currentIndex)}
                                    className="flex items-center gap-2 px-6 py-3 bg-surface hover:bg-background text-text-main border border-border rounded-2xl transition-all"
                                >
                                    <Edit2 className="w-5 h-5" />
                                    <span className="font-bold">Edit</span>
                                </button>
                                <button
                                    onClick={handleNext}
                                    className="flex items-center gap-2 px-10 py-3 bg-primary hover:bg-primary/90 text-background rounded-2xl transition-all shadow-lg shadow-primary/20"
                                >
                                    <span className="font-bold">Keep</span>
                                    <ChevronRight className="w-5 h-5" />
                                </button>
                            </div>
                        </motion.div>
                    </AnimatePresence>
                </div>

                <button
                    onClick={handleNext}
                    disabled={currentIndex === cards.length - 1}
                    className="absolute right-8 z-10 p-4 bg-surface/50 border border-border rounded-full hover:bg-surface disabled:opacity-0 transition-all"
                >
                    <ChevronRight className="w-8 h-8" />
                </button>
            </div>

            {/* Footer / Instructions */}
            <div className="px-8 py-6 border-t border-border/50 flex items-center justify-between text-text-muted">
                <div className="flex items-center gap-4 text-xs">
                    <div className="flex items-center gap-1.5">
                        <Keyboard className="w-4 h-4" />
                        <span className="font-medium">Keyboard Driven</span>
                    </div>
                    <div className="w-px h-3 bg-border/50" />
                    <div className="flex items-center gap-1.5">
                        <Info className="w-4 h-4" />
                        <span>Cards kept here will be ready for the final sync</span>
                    </div>
                </div>

                <button
                    onClick={onSync}
                    className="px-8 py-2 bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30 rounded-xl font-bold transition-all"
                >
                    Finish & Sync All
                </button>
            </div>
        </motion.div>
    );
};
