import { memo } from 'react';
import { Layers, Edit2, Archive, Trash2, CheckSquare, Square } from 'lucide-react';
import { clsx } from 'clsx';
import { CardEditor } from './CardEditor';
import { highlightCloze } from '../utils/cloze';
import { getCardSlideNumber } from '../utils/cardMetadata';
import type { Card } from '../api';

interface CardItemProps {
    card: Card;
    originalIndex: number;
    isEditing: boolean;
    isSelected: boolean;
    isMultiSelectMode: boolean;
    step: 'dashboard' | 'config' | 'generating' | 'done';
    editForm: Card | null;
    onStartEdit: (index: number) => void;
    onCancelEdit: () => void;
    onSaveEdit: (index: number) => void;
    onFieldChange: (field: string, value: string) => void;
    onFeedbackChange: (vote: 'up' | 'down' | null, reason: string) => void;
    onSetConfirmModal: (modal: { isOpen: boolean; type: 'lectern' | 'anki'; index: number; noteId?: number }) => void;
    onToggleSelection: (uid: string) => void;
    onSelectRange: (uid: string) => void;
}

function isCloze(card: { model_name?: string }): boolean {
    return (card.model_name || '').toLowerCase().includes('cloze');
}

/**
 * Single card item component with memoization for optimal re-render performance.
 */
export const CardItem = memo(function CardItem({
    card,
    originalIndex,
    isEditing,
    isSelected,
    isMultiSelectMode,
    step,
    editForm,
    onStartEdit,
    onCancelEdit,
    onSaveEdit,
    onFieldChange,
    onFeedbackChange,
    onSetConfirmModal,
    onToggleSelection,
    onSelectRange,
}: CardItemProps) {
    const cloze = isCloze(card);
    const slideNumber = getCardSlideNumber(card);

    // Handle card click with keyboard modifiers
    const handleCardClick = (e: React.MouseEvent) => {
        if (!isMultiSelectMode || !card._uid || isEditing) return;

        // Shift+Click: range selection
        if (e.shiftKey) {
            e.preventDefault();
            onSelectRange(card._uid);
        }
        // Cmd/Ctrl+Click: toggle selection
        else if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            onToggleSelection(card._uid);
        }
    };

    return (
        <div
            onClick={handleCardClick}
            className={clsx(
                "bg-surface rounded-xl shadow-sm relative overflow-hidden group transition-colors duration-200",
                isMultiSelectMode && !isEditing && "cursor-pointer",
                isEditing
                    ? "border-2 border-primary/50 bg-primary/5"
                    : clsx(
                        "border hover:border-border/80 hover:shadow-md",
                        isSelected
                            ? "border-primary/50 ring-2 ring-primary/20"
                            : "border-border",
                        cloze ? "border-l-4 border-l-blue-500/50" : "border-l-4 border-l-primary/50"
                    )
            )}
        >
            {isEditing && editForm ? (
                /* Edit Mode - Using CardEditor Component */
                <CardEditor
                    card={editForm}
                    onSave={() => onSaveEdit(originalIndex)}
                    onCancel={onCancelEdit}
                    onChange={onFieldChange}
                    onFeedbackChange={onFeedbackChange}
                    isSaving={false}
                />
            ) : (
                /* View Mode */
                <>
                    {/* Card header */}
                    <div className="flex items-center justify-between px-5 py-3 border-b border-border/50">
                        <div className="flex items-center gap-2">
                            {/* Multi-select checkbox */}
                            {isMultiSelectMode && card._uid && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        // Shift+Click: range selection
                                        if (e.shiftKey) {
                                            onSelectRange(card._uid!);
                                        } else {
                                            onToggleSelection(card._uid!);
                                        }
                                    }}
                                    className={clsx(
                                        "p-0.5 rounded transition-colors",
                                        isSelected
                                            ? "text-primary"
                                            : "text-text-muted hover:text-text-main"
                                    )}
                                >
                                    {isSelected ? (
                                        <CheckSquare className="w-4 h-4" />
                                    ) : (
                                        <Square className="w-4 h-4" />
                                    )}
                                </button>
                            )}
                            <span className={clsx(
                                "text-[10px] font-bold tracking-widest uppercase",
                                cloze ? "text-blue-400" : "text-primary"
                            )}>
                                {card.model_name || 'Basic'}
                            </span>
                            <span className="text-text-muted/30">•</span>
                            <span className="flex items-center gap-1 text-[10px] font-medium text-text-muted">
                                <Layers className="w-3 h-3 opacity-50" />
                                SLIDE {slideNumber ?? '?'}
                            </span>
                            {card.slide_topic && (
                                <>
                                    <span className="text-text-muted/30">•</span>
                                    <span className="text-[10px] text-text-muted truncate max-w-[200px]" title={card.slide_topic}>
                                        {card.slide_topic}
                                    </span>
                                </>
                            )}
                        </div>

                        {/* Actions (only when done) */}
                        {step === 'done' && (
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                    onClick={() => onStartEdit(originalIndex)}
                                    className="p-1.5 hover:bg-surface rounded text-text-muted hover:text-primary transition-colors"
                                    title="Edit"
                                >
                                    <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                    onClick={() => onSetConfirmModal({ isOpen: true, type: 'lectern', index: originalIndex })}
                                    className="p-1.5 hover:bg-surface rounded text-text-muted hover:text-text-main transition-colors"
                                    title="Remove"
                                >
                                    <Archive className="w-3.5 h-3.5" />
                                </button>
                                {card.anki_note_id && (
                                    <button
                                        onClick={() => onSetConfirmModal({ isOpen: true, type: 'anki', index: originalIndex, noteId: card.anki_note_id })}
                                        className="p-1.5 hover:bg-red-500/10 rounded text-red-300 hover:text-red-400 transition-colors"
                                        title="Delete from Anki"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Card body */}
                    <div className="p-5 space-y-5">
                        {Object.entries(card.fields || {}).map(([key, value]) => (
                            <div key={key}>
                                <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1.5">{key}</div>
                                <div className="text-sm text-text-main leading-relaxed prose prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: highlightCloze(String(value)) }} />
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}, (prevProps, nextProps) => {
    // Custom comparison for optimal memoization
    return (
        prevProps.card._uid === nextProps.card._uid &&
        prevProps.isEditing === nextProps.isEditing &&
        prevProps.isSelected === nextProps.isSelected &&
        prevProps.isMultiSelectMode === nextProps.isMultiSelectMode &&
        prevProps.step === nextProps.step &&
        prevProps.editForm === nextProps.editForm
    );
});
