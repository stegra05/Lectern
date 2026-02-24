import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform } from 'framer-motion';
import { Trash2, Edit2, X, ChevronRight, CornerDownLeft, Sparkles } from 'lucide-react';
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
    const [direction, setDirection] = useState(0);

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
        if (currentIndex >= cards.length - 1 && currentIndex > 0) {
            setCurrentIndex(prev => prev - 1);
        }
    }, [currentIndex, onDelete, cards.length]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Disallow keyboard shortcuts when typing in inputs/textareas
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
                return;
            }
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
            } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                onSync();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleNext, handlePrev, handleDelete, onEdit, onClose, onSync, currentIndex]);

    const x = useMotionValue(0);
    const rotate = useTransform(x, [-300, 300], [-10, 10]);
    const opacity = useTransform(x, [-300, -100, 0, 100, 300], [0, 1, 1, 1, 0]);
    const scale = useTransform(x, [-300, 0, 300], [0.8, 1, 0.8]);

    const handleDragEnd = (_event: any, info: any) => {
        if (info.offset.x < -100) {
            handleDelete();
        } else if (info.offset.x > 100) {
            handleNext();
        }
    };

    if (!currentCard) {
        return (
            <div className="fixed inset-0 z-[100] bg-background flex flex-col items-center justify-center p-8">
                <p className="text-text-muted mb-8 italic text-lg opacity-70">Silence fell. No cards remain.</p>
                <button onClick={onClose} className="px-8 py-4 bg-surface/50 border border-border rounded-full hover:bg-surface hover:text-text-main transition-all shadow-xl shadow-black/50 backdrop-blur-md">
                    Return to reality
                </button>
            </div>
        );
    }

    const progress = ((currentIndex + 1) / cards.length) * 100;

    const variants = {
        enter: (direction: number) => ({
            x: direction > 0 ? 300 : -300,
            opacity: 0,
            scale: 0.95,
            rotate: direction > 0 ? 5 : -5
        }),
        center: {
            zIndex: 1,
            x: 0,
            opacity: 1,
            scale: 1,
            rotate: 0
        },
        exit: (direction: number) => ({
            zIndex: 0,
            x: direction < 0 ? 300 : -300,
            opacity: 0,
            scale: 0.95,
            rotate: direction < 0 ? 5 : -5
        }),
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-background flex flex-col overflow-hidden font-sans"
        >
            {/* Ambient Lighting Gradient */}
            <div
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[100vw] h-[100vh] pointer-events-none"
                style={{ background: 'radial-gradient(circle at center, rgba(132,204,22,0.08) 0%, transparent 50%)' }}
            />

            {/* Ambient Progress Bar */}
            <div className="absolute top-0 left-0 h-1 bg-surface w-full z-50 overflow-hidden">
                <motion.div
                    className="h-full bg-primary w-full"
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: progress / 100 }}
                    style={{ originX: 0 }}
                    transition={{ duration: 0.4, ease: "circOut" }}
                />
            </div>

            {/* Ghost Chrome (Top) */}
            <div className="absolute top-8 left-8 right-8 flex items-center justify-between opacity-30 hover:opacity-100 transition-opacity duration-500 z-50">
                <div className="flex items-center gap-3">
                    <span className="text-primary font-bold tracking-widest">{currentIndex + 1}</span>
                    <span className="text-text-muted">/</span>
                    <span className="text-text-muted font-bold tracking-widest">{cards.length}</span>
                </div>
                <button
                    onClick={onClose}
                    className="p-3 bg-[#1A1A1A] hover:bg-surface rounded-full border border-border/50 transition-all text-text-muted hover:text-text-main"
                >
                    <X className="w-5 h-5" />
                </button>
            </div>

            {/* The Void: Interactive Stage */}
            <div className="flex-1 flex items-center justify-center relative px-8 pb-32 pt-24 overflow-hidden">
                <AnimatePresence initial={false} custom={direction} mode="wait">
                    <motion.div
                        key={currentCard?._uid || currentIndex}
                        custom={direction}
                        variants={variants}
                        initial="enter"
                        animate="center"
                        exit="exit"
                        transition={{
                            x: { type: "spring", stiffness: 400, damping: 40, mass: 0.8 },
                            opacity: { duration: 0.15 },
                        }}
                        drag="x"
                        dragConstraints={{ left: 0, right: 0 }}
                        dragElastic={1}
                        onDragEnd={handleDragEnd}
                        style={{ x, rotate, opacity, scale, willChange: 'transform, opacity' }}
                        className="w-full max-w-4xl cursor-grab active:cursor-grabbing bg-transparent flex flex-col justify-center min-h-[40vh] py-12"
                    >
                        {/* Organic Card Content */}
                        <div className="flex flex-col gap-12">
                            {/* Slide Context */}
                            <div className="flex items-center gap-4">
                                <span className="px-3 py-1 bg-primary/10 border border-primary/20 rounded-full text-xs font-bold text-primary uppercase tracking-widest shadow-sm">
                                    {currentCard.model_name || 'Basic'}
                                </span>
                                {currentCard.slide_topic && (
                                    <span className="text-sm text-text-muted font-medium tracking-wide">
                                        {currentCard.slide_topic}
                                    </span>
                                )}
                            </div>

                            {/* Render Fields */}
                            <div className="space-y-16">
                                {Object.entries(currentCard.fields || {}).map(([key, value], idx) => {
                                    const isFront = idx === 0;

                                    // Make cloze deletions glow softly
                                    let htmlContent = String(value);
                                    if (currentCard.model_name?.toLowerCase().includes('cloze')) {
                                        htmlContent = htmlContent.replace(
                                            /{{c\d+::(.*?)}}/g,
                                            '<span class="bg-primary/20 text-primary px-1.5 py-0.5 rounded font-semibold">$1</span>'
                                        );
                                    }

                                    return (
                                        <div key={key} className="flex flex-col gap-4">
                                            <div className="text-[10px] font-bold text-text-muted/40 uppercase tracking-[0.2em]">{key}</div>
                                            <div
                                                className={`${isFront ? 'text-4xl md:text-5xl font-bold tracking-tight text-white' : 'text-xl md:text-2xl font-medium text-text-muted/90'} leading-relaxed prose prose-invert max-w-none`}
                                                dangerouslySetInnerHTML={{ __html: htmlContent }}
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </motion.div>
                </AnimatePresence>
            </div>

            {/* Floating Operations Dock */}
            <div className="absolute bottom-12 left-1/2 -translate-x-1/2 flex flex-col items-center gap-6 z-50 pointer-events-none">

                {/* Drag Insights */}
                <div className="flex items-center gap-16 text-[10px] font-bold uppercase tracking-[0.3em] text-text-muted/30">
                    <span className="flex items-center gap-2"><CornerDownLeft className="w-3 h-3" /> Discard</span>
                    <span>Triage</span>
                    <span className="flex items-center gap-2">Keep <ChevronRight className="w-3 h-3" /></span>
                </div>

                {/* Dock Container */}
                <div className="flex items-center gap-2 p-2 bg-[#121212]/95 border border-border/50 rounded-full shadow-2xl shadow-black pointer-events-auto">
                    <button
                        onClick={handleDelete}
                        className="group flex items-center justify-center w-14 h-14 rounded-full hover:bg-red-500/10 hover:text-red-400 text-text-muted transition-all"
                        title="Discard (Del)"
                    >
                        <Trash2 className="w-5 h-5 group-hover:scale-110 transition-transform" />
                    </button>

                    <div className="w-px h-8 bg-border/50" />

                    <button
                        onClick={() => onEdit(currentIndex)}
                        className="group flex items-center justify-center w-14 h-14 rounded-full hover:bg-surface hover:text-text-main text-text-muted transition-all"
                        title="Edit (E)"
                    >
                        <Edit2 className="w-5 h-5 group-hover:scale-110 transition-transform" />
                    </button>

                    <div className="w-px h-8 bg-border/50" />

                    <button
                        onClick={handleNext}
                        className="group flex items-center justify-center gap-2 px-6 h-14 rounded-full bg-primary/10 hover:bg-primary/20 text-primary transition-all"
                        title="Keep (Space)"
                    >
                        <span className="text-xs font-bold uppercase tracking-widest hidden md:block">Keep</span>
                        <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                    </button>

                    {currentIndex === cards.length - 1 && (
                        <div className="pl-2 ml-2 border-l border-border/50 flex">
                            <button
                                onClick={onSync}
                                className="group flex items-center gap-2 px-8 h-14 rounded-full bg-primary hover:bg-primary/90 text-background transition-all shadow-[0_0_30px_rgba(132,204,22,0.2)] hover:shadow-[0_0_40px_rgba(132,204,22,0.4)]"
                                title="Sync All (Cmd+Enter)"
                            >
                                <Sparkles className="w-4 h-4 fill-background" />
                                <span className="text-sm font-bold uppercase tracking-wider">Sync Final</span>
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </motion.div>
    );
};
