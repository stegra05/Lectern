import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, EyeOff, Save, X, RotateCcw, Tag } from 'lucide-react';
import { clsx } from 'clsx';
import DOMPurify from 'dompurify';
import type { Card } from '../api';
import { renderClozeFront, renderClozeBack } from '../utils/cloze';
import { RichTextEditor } from './RichTextEditor';

interface CardEditorProps {
    card: Card;
    onSave: () => void;
    onCancel: () => void;
    onChange: (field: string, value: string) => void;
    isSaving?: boolean;
}

/** Neutral character count display */
const CharCount: React.FC<{ count: number }> = ({ count }) => (
    <span className="text-[10px] font-mono text-text-muted/50">
        {count}
    </span>
);

/** Anki-style card preview with flip animation */
const CardPreview: React.FC<{
    front: string;
    back: string;
    onFlip: () => void;
    isFlipped: boolean;
}> = ({ front, back, onFlip, isFlipped }) => {
    return (
        <div
            onClick={onFlip}
            className="cursor-pointer perspective-1000"
        >
            <motion.div
                className="relative w-full preserve-3d"
                animate={{ rotateY: isFlipped ? 180 : 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
            >
                {/* Front of card */}
                <div
                    className={clsx(
                        "min-h-[200px] p-6 rounded-xl border-2 border-primary/30 bg-gradient-to-br from-primary/5 to-primary/10",
                        "flex flex-col items-center justify-center text-center",
                        "backface-hidden",
                        isFlipped && "invisible"
                    )}
                >
                    <div className="text-[10px] font-bold text-primary/50 uppercase tracking-widest mb-3">
                        Question
                    </div>
                    <div
                        className="text-lg text-text-main leading-relaxed prose prose-invert max-w-none"
                        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(front) }}
                    />
                    <div className="mt-4 text-[10px] text-text-muted/50">
                        Click to reveal answer
                    </div>
                </div>

                {/* Back of card */}
                <div
                    className={clsx(
                        "absolute inset-0 min-h-[200px] p-6 rounded-xl border-2 border-blue-500/30 bg-gradient-to-br from-blue-500/5 to-blue-500/10",
                        "flex flex-col items-center justify-center text-center",
                        "backface-hidden rotate-y-180",
                        !isFlipped && "invisible"
                    )}
                >
                    <div className="text-[10px] font-bold text-blue-400/50 uppercase tracking-widest mb-3">
                        Answer
                    </div>
                    <div
                        className="text-base text-text-main leading-relaxed prose prose-invert max-w-none"
                        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(back) }}
                    />
                </div>
            </motion.div>
        </div>
    );
};

export const CardEditor: React.FC<CardEditorProps> = ({
    card,
    onSave,
    onCancel,
    onChange,
    isSaving = false,
}) => {
    const [isPreviewMode, setIsPreviewMode] = useState(false);
    const [isFlipped, setIsFlipped] = useState(false);

    // Get fields from card
    const fields = card.fields || {};
    const fieldEntries = Object.entries(fields);
    const isCloze = (card.model_name || '').toLowerCase().includes('cloze');
    const getFrontContent = () => {
        if (fieldEntries.length === 0) return '';
        const rawFront = fieldEntries[0][1];
        return isCloze ? renderClozeFront(String(rawFront)) : String(rawFront);
    };

    const getBackContent = () => {
        if (fieldEntries.length === 0) return '';
        if (isCloze) return renderClozeBack(String(fieldEntries[0][1]));
        const rawBack = fieldEntries.length > 1 ? fieldEntries[1][1] : fieldEntries[0][1];
        return String(rawBack);
    };

    // Use browser defaults for Tab handling. Only listen for Cmd+Enter to save and Esc to cancel.
    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLElement>) => {
            // Cmd/Ctrl + Enter to save
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                onSave();
            }

            // Escape to cancel
            if (e.key === 'Escape') {
                e.preventDefault();
                onCancel();
            }
        },
        [onSave, onCancel]
    );

    const togglePreview = () => {
        setIsPreviewMode(!isPreviewMode);
        setIsFlipped(false);
    };

    return (
        <div className="p-5 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-primary uppercase tracking-wider">
                        Editing Card
                    </span>
                    {/* Topic badge - read-only metadata */}
                    {card.slide_topic !== undefined && (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-primary/10 text-primary/70 text-[10px] font-medium">
                            <Tag className="w-3 h-3" />
                            {card.slide_topic}
                        </span>
                    )}
                    <span className="text-[10px] text-text-muted/50 font-mono">
                        Tab to navigate | Cmd+Enter to save
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    {/* Preview Toggle */}
                    <button
                        onClick={togglePreview}
                        className={clsx(
                            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                            isPreviewMode
                                ? "bg-primary/20 text-primary border border-primary/30"
                                : "bg-surface text-text-muted hover:text-text-main border border-border hover:border-border/80"
                        )}
                        title={isPreviewMode ? "Switch to edit mode" : "Preview card"}
                    >
                        {isPreviewMode ? (
                            <>
                                <EyeOff className="w-3.5 h-3.5" />
                                Edit
                            </>
                        ) : (
                            <>
                                <Eye className="w-3.5 h-3.5" />
                                Preview
                            </>
                        )}
                    </button>

                    <div className="w-px h-5 bg-border" />

                    {/* Cancel button */}
                    <button
                        onClick={onCancel}
                        disabled={isSaving}
                        className="p-1.5 hover:bg-surface rounded-lg text-text-muted hover:text-text-main transition-colors disabled:opacity-50"
                        title="Cancel (Esc)"
                    >
                        <X className="w-4 h-4" />
                    </button>

                    {/* Save button */}
                    <button
                        onClick={onSave}
                        disabled={isSaving}
                        className={clsx(
                            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all",
                            isSaving
                                ? "bg-primary/50 text-background/70 cursor-wait"
                                : "bg-primary hover:bg-primary/90 text-background"
                        )}
                        title="Save (Cmd+Enter)"
                    >
                        {isSaving ? (
                            <>
                                <RotateCcw className="w-4 h-4 animate-spin" />
                                Saving
                            </>
                        ) : (
                            <>
                                <Save className="w-4 h-4" />
                                Save
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* Content: Preview or Edit */}
            <AnimatePresence mode="wait">
                {isPreviewMode ? (
                    <motion.div
                        key="preview"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.2 }}
                    >
                        <CardPreview
                            front={getFrontContent()}
                            back={getBackContent()}
                            onFlip={() => setIsFlipped(!isFlipped)}
                            isFlipped={isFlipped}
                        />
                    </motion.div>
                ) : (
                    <motion.div
                        key="edit"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.2 }}
                        className="space-y-4"
                    >
                        {/* Field editors */}
                        {fieldEntries.map(([key, value]) => (
                            <div key={key}>
                                <div className="flex items-center justify-between mb-1.5">
                                    <label className="block text-[10px] font-bold text-text-muted uppercase tracking-wider">
                                        {key}
                                    </label>
                                    <CharCount count={String(value).length} />
                                </div>
                                <RichTextEditor
                                    value={String(value)}
                                    onChange={(newVal) => onChange(key, newVal)}
                                    onKeyDown={handleKeyDown}
                                    disabled={isSaving}
                                    placeholder={`Enter ${key.toLowerCase()}...`}
                                />
                            </div>
                        ))}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default CardEditor;
