import { memo, useRef, useEffect } from 'react';
import { AlertCircle } from 'lucide-react';
import { CardItem } from './CardItem';
import { CardSkeleton } from './CardSkeleton';
import type { Card } from '../api';

interface CardListProps {
    cards: Card[];
    sortedCards: Card[];
    uidToIndex: Map<string, number>;
    editingIndex: number | null;
    editForm: Card | null;
    isMultiSelectMode: boolean;
    selectedCards: Set<string>;
    step: 'dashboard' | 'config' | 'generating' | 'done';
    isGenerating: boolean;
    onStartEdit: (index: number) => void;
    onCancelEdit: () => void;
    onSaveEdit: (index: number) => void;
    onFieldChange: (field: string, value: string) => void;
    onSetConfirmModal: (modal: { isOpen: boolean; type: 'lectern' | 'anki'; index: number; noteId?: number }) => void;
    onToggleSelection: (uid: string) => void;
    onSelectRange: (uid: string) => void;
    onSelectAll: (cardUids?: string[]) => void;
    onClearSelection: () => void;
}

/**
 * Render a single card item - extracted to avoid duplication
 */
function RenderCardItem({
    card,
    uidToIndex,
    editingIndex,
    editForm,
    isMultiSelectMode,
    selectedCards,
    step,
    onStartEdit,
    onCancelEdit,
    onSaveEdit,
    onFieldChange,
    onSetConfirmModal,
    onToggleSelection,
    onSelectRange,
}: {
    card: Card;
    uidToIndex: Map<string, number>;
    editingIndex: number | null;
    editForm: Card | null;
    isMultiSelectMode: boolean;
    selectedCards: Set<string>;
    step: 'dashboard' | 'config' | 'generating' | 'done';
    onStartEdit: (index: number) => void;
    onCancelEdit: () => void;
    onSaveEdit: (index: number) => void;
    onFieldChange: (field: string, value: string) => void;
    onSetConfirmModal: (modal: { isOpen: boolean; type: 'lectern' | 'anki'; index: number; noteId?: number }) => void;
    onToggleSelection: (uid: string) => void;
    onSelectRange: (uid: string) => void;
}) {
    const originalIndex = card._uid ? (uidToIndex.get(card._uid) ?? -1) : -1;
    const isEditing = editingIndex === originalIndex;
    const isSelected = card._uid ? selectedCards.has(card._uid) : false;

    return (
        <CardItem
            card={card}
            originalIndex={originalIndex}
            isEditing={isEditing}
            isSelected={isSelected}
            isMultiSelectMode={isMultiSelectMode}
            step={step}
            editForm={isEditing ? editForm : null}
            onStartEdit={onStartEdit}
            onCancelEdit={onCancelEdit}
            onSaveEdit={onSaveEdit}
            onFieldChange={onFieldChange}
            onSetConfirmModal={onSetConfirmModal}
            onToggleSelection={onToggleSelection}
            onSelectRange={onSelectRange}
        />
    );
}

/**
 * Standard card list component.
 * Virtualization was removed due to stability issues with absolute positioning 
 * causing cards to stack on top of each other. React handles 100-300 memoized nodes easily.
 */
export const CardList = memo(function CardList({
    cards,
    sortedCards,
    uidToIndex,
    editingIndex,
    editForm,
    isMultiSelectMode,
    selectedCards,
    step,
    isGenerating,
    onStartEdit,
    onCancelEdit,
    onSaveEdit,
    onFieldChange,
    onSetConfirmModal,
    onToggleSelection,
    onSelectRange,
    onSelectAll,
    onClearSelection,
}: CardListProps) {
    const scrollRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom during generation if user is at the bottom
    useEffect(() => {
        if (isGenerating && scrollRef.current) {
            const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
            const isNearBottom = scrollHeight - scrollTop - clientHeight < 150;
            if (isNearBottom) {
                scrollRef.current.scrollTop = scrollHeight;
            }
        }
    }, [sortedCards.length, isGenerating]);

    return (
        <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto p-6 min-h-0 scrollbar-thin scrollbar-thumb-border"
        >
            {/* Select All button (only in multi-select mode with cards) */}
            {isMultiSelectMode && sortedCards.length > 0 && (
                <div className="flex items-center justify-between px-2 py-2 mb-2">
                    <button
                        onClick={() =>
                            onSelectAll(
                                sortedCards
                                    .map((card) => card._uid)
                                    .filter((uid): uid is string => Boolean(uid))
                            )
                        }
                        className="text-xs text-primary hover:text-primary/80 font-medium"
                    >
                        Select All ({sortedCards.length})
                    </button>
                    {selectedCards.size > 0 && (
                        <button
                            onClick={onClearSelection}
                            className="text-xs text-text-muted hover:text-text-main"
                        >
                            Clear Selection
                        </button>
                    )}
                </div>
            )}

            {/* Loading skeletons - only during initial generation when no cards exist yet */}
            {isGenerating && cards.length === 0 && (
                <div className="space-y-4">
                    {[1, 2, 3].map((i) => (
                        <CardSkeleton key={i} />
                    ))}
                </div>
            )}

            {/* Card list */}
            {sortedCards.length > 0 && (
                <div className="space-y-4">
                    {sortedCards.map((card, index) => (
                        <RenderCardItem
                            key={card._uid || `card-fallback-${index}`}
                            card={card}
                            uidToIndex={uidToIndex}
                            editingIndex={editingIndex}
                            editForm={editForm}
                            isMultiSelectMode={isMultiSelectMode}
                            selectedCards={selectedCards}
                            step={step}
                            onStartEdit={onStartEdit}
                            onCancelEdit={onCancelEdit}
                            onSaveEdit={onSaveEdit}
                            onFieldChange={onFieldChange}
                            onSetConfirmModal={onSetConfirmModal}
                            onToggleSelection={onToggleSelection}
                            onSelectRange={onSelectRange}
                        />
                    ))}
                </div>
            )}

            {/* Empty State - only show when not in active generation */}
            {cards.length === 0 && !isGenerating && (
                <div className="h-full flex flex-col items-center justify-center text-text-muted border-2 border-dashed border-border rounded-xl bg-surface/20 min-h-[300px]">
                    <AlertCircle className="w-8 h-8 mb-4 opacity-20" />
                    <p className="font-medium">Waiting for cards…</p>
                    <p className="text-sm opacity-50 mt-1">Cards will appear here as they are generated</p>
                </div>
            )}
        </div>
    );
});
