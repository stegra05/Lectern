import { memo } from 'react';
import { Layers, Search, CheckSquare, Maximize2 } from 'lucide-react';
import { clsx } from 'clsx';
import type { SortOption } from '../hooks/types';

interface CardToolbarProps {
    step: 'dashboard' | 'config' | 'generating' | 'done';
    isHistorical: boolean;
    sortBy: SortOption;
    onSortChange: (sort: SortOption) => void;
    searchQuery: string;
    onSearchChange: (query: string) => void;
    isMultiSelectMode: boolean;
    onToggleMultiSelect: () => void;
    filteredCount: number;
    onFocusMode?: () => void;
}

/**
 * Card toolbar component for search, sort, and multi-select controls.
 * Memoized to prevent re-renders when unrelated state changes.
 */
export const CardToolbar = memo(function CardToolbar({
    step,
    isHistorical,
    sortBy,
    onSortChange,
    searchQuery,
    onSearchChange,
    isMultiSelectMode,
    onToggleMultiSelect,
    filteredCount,
    onFocusMode,
}: CardToolbarProps) {
    return (
        <div className="h-14 px-6 border-b border-border flex items-center justify-between bg-surface/30 backdrop-blur-sm shrink-0 rounded-tr-2xl">
            <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 text-text-main font-semibold text-sm">
                    <Layers className="w-4 h-4 text-primary" />
                    {isHistorical ? (
                        <span className="flex items-center gap-2">
                            Archive View
                            <span className="px-2 py-0.5 bg-primary/10 border border-primary/20 rounded text-[10px] font-mono text-primary">HISTORICAL</span>
                        </span>
                    ) : (
                        step === 'done' ? 'Review Queue' : 'Live Preview'
                    )}
                </div>
                <div className="h-4 w-px bg-border" />
                {/* Sort Pills */}
                <div className="flex p-0.5 bg-surface/50 rounded-lg border border-border/50 text-[10px] font-bold">
                    {(['creation', 'topic', 'slide', 'type'] as const).map((opt) => (
                        <button
                            key={opt}
                            onClick={() => onSortChange(opt)}
                            className={clsx(
                                "px-3 py-1 uppercase tracking-wider rounded-md transition-all",
                                sortBy === opt
                                    ? "bg-primary text-background shadow-sm"
                                    : "text-text-muted hover:text-text-main"
                            )}
                        >
                            {opt}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex items-center gap-3">
                {/* Focus Mode Toggle */}
                {step === 'done' && onFocusMode && (
                    <button
                        onClick={onFocusMode}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-primary/10 border border-primary/20 text-primary rounded-lg text-xs font-medium hover:bg-primary/20 transition-all shadow-sm"
                        title="Enter Focus Mode"
                    >
                        <Maximize2 className="w-3.5 h-3.5" />
                        Focus Mode
                    </button>
                )}
                {/* Multi-select toggle (only in done step) */}
                {step === 'done' && (
                    <button
                        onClick={onToggleMultiSelect}
                        className={clsx(
                            "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all",
                            isMultiSelectMode
                                ? "bg-primary text-background shadow-sm"
                                : "bg-surface/50 border border-border/50 text-text-muted hover:text-text-main hover:border-border"
                        )}
                        title={isMultiSelectMode ? "Exit multi-select" : "Multi-select mode"}
                    >
                        <CheckSquare className="w-3.5 h-3.5" />
                        {isMultiSelectMode ? "Done" : "Select"}
                    </button>
                )}
                <div className="relative group">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted group-focus-within:text-primary transition-colors" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => onSearchChange(e.target.value)}
                        placeholder="Search..."
                        className="pl-8 pr-3 py-1.5 text-xs bg-surface/50 border border-border/50 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50 w-36 focus:w-52 transition-all duration-300 placeholder:text-text-muted/50"
                    />
                </div>
                <div className="flex items-center px-2 py-1 bg-surface rounded border border-border text-[10px] font-mono text-text-muted">
                    <span className="font-bold text-text-main mr-1">{filteredCount}</span> CARDS
                </div>
            </div>
        </div>
    );
});
