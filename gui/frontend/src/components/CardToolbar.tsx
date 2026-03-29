import { memo, useState } from 'react';
import { Layers, Search, CheckSquare, Maximize2, LayoutGrid, List, ListFilter } from 'lucide-react';
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
    selectedCount: number;
    onToggleMultiSelect: () => void;
    filteredCount: number;
    onFocusMode?: () => void;
    isCompactMode: boolean;
    onToggleCompactMode: (isCompact: boolean) => void;
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
    selectedCount,
    onToggleMultiSelect,
    filteredCount,
    onFocusMode,
    isCompactMode,
    onToggleCompactMode,
}: CardToolbarProps) {
    const [isFilterOpen, setIsFilterOpen] = useState(false);

    return (
        <div className="h-14 px-6 border-b border-border flex items-center bg-surface/30 backdrop-blur-sm shrink-0 rounded-tr-2xl relative z-50">
            {/* Left Section: Breadcrumb & View Status */}
            <div className="flex items-center gap-4 h-full shrink-0">
                <div className="flex items-center gap-2 text-text-main font-semibold text-sm whitespace-nowrap">
                    <Layers className="w-4 h-4 text-primary" />
                    Archive View
                </div>
                
                <div className="h-4 w-px bg-border" />
                
                <div className="flex gap-8 text-sm font-medium h-full items-center">
                    <div className="relative h-full flex items-center cursor-default">
                        <span className="text-primary font-bold tracking-widest text-[10px] uppercase">
                            {isHistorical ? 'Historical' : 'Creation'}
                        </span>
                        <div className="absolute bottom-0 left-0 right-0 h-[1.5px] bg-primary shadow-[0_0_8px_rgba(163,230,53,0.4)]" />
                    </div>
                    
                    {/* Filter Dropdown */}
                    <div className="relative flex items-center h-full">
                        <button 
                            onClick={() => setIsFilterOpen(!isFilterOpen)} 
                            className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-text-muted hover:text-text-main transition-colors px-3 py-1.5 rounded-md hover:bg-surface border border-transparent hover:border-border"
                        >
                            <ListFilter className="w-3.5 h-3.5" />
                            Filter
                        </button>
                        {isFilterOpen && (
                            <>
                                <div className="fixed inset-0 z-[60]" onClick={() => setIsFilterOpen(false)} />
                                <div className="absolute top-[calc(100%-8px)] left-0 w-32 bg-surface/95 backdrop-blur-md border border-border rounded-lg shadow-xl overflow-hidden py-1 z-[70]">
                                    {(['creation', 'topic', 'slide', 'type'] as const).map(opt => (
                                        <button
                                            key={opt}
                                            onClick={() => { onSortChange(opt); setIsFilterOpen(false); }}
                                            className={clsx(
                                                "w-full text-left px-4 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors",
                                                sortBy === opt ? "bg-primary/10 text-primary" : "text-text-muted hover:bg-surface-hover hover:text-text-main"
                                            )}
                                        >
                                            {opt}
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Center Section: Search Bar (Centered Prominence) */}
            <div className="flex-1 flex justify-center px-12">
                <div className="relative group w-full max-w-md">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted group-focus-within:text-primary transition-colors" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => onSearchChange(e.target.value)}
                        placeholder="Search Archive..."
                        className="w-full pl-10 pr-4 py-2 text-xs bg-surface/50 border border-border/40 rounded-xl focus:outline-none focus:border-primary/50 focus:bg-surface/80 focus:ring-1 focus:ring-primary/20 transition-all duration-300 placeholder:text-text-muted/50 shadow-sm"
                    />
                </div>
            </div>

            {/* Right Section: View Toggles, Actions & Stats */}
            <div className="flex items-center gap-3 shrink-0">
                {/* View Mode Toggle */}
                {step === 'done' && (
                    <div className="flex items-center bg-surface/50 rounded-lg p-0.5 border border-border">
                        <button
                            onClick={() => onToggleCompactMode(false)}
                            className={clsx(
                                "p-1.5 rounded-md transition-colors",
                                !isCompactMode 
                                    ? "bg-primary/20 text-primary shadow-sm" 
                                    : "text-text-muted hover:text-text-main hover:bg-surface"
                            )}
                            title="Card View"
                        >
                            <LayoutGrid className="w-3.5 h-3.5" />
                        </button>
                        <button
                            onClick={() => onToggleCompactMode(true)}
                            className={clsx(
                                "p-1.5 rounded-md transition-colors",
                                isCompactMode 
                                    ? "bg-primary/20 text-primary shadow-sm" 
                                    : "text-text-muted hover:text-text-main hover:bg-surface"
                            )}
                            title="Compact View"
                        >
                            <List className="w-3.5 h-3.5" />
                        </button>
                    </div>
                )}
                
                {/* Multi-select toggle (only in done step) */}
                {step === 'done' && (
                    <button
                        onClick={onToggleMultiSelect}
                        className={clsx(
                            "p-1.5 rounded-lg transition-colors flex items-center justify-center",
                            isMultiSelectMode
                                ? "bg-primary/10 text-primary"
                                : "bg-surface hover:bg-surface/80 text-text-muted hover:text-text-main"
                        )}
                        title={isMultiSelectMode ? "Exit multi-select" : "Multi-select mode"}
                    >
                        <CheckSquare className="w-4 h-4" />
                    </button>
                )}
                
                {/* Focus Mode Toggle */}
                {step === 'done' && onFocusMode && (
                    <button
                        onClick={onFocusMode}
                        className="p-1.5 bg-surface hover:bg-surface/80 text-text-muted hover:text-primary rounded-lg transition-colors flex items-center justify-center"
                        title="Enter Focus Mode"
                    >
                        <Maximize2 className="w-4 h-4" />
                    </button>
                )}
                
                {step === 'done' && isMultiSelectMode && (
                    <span className="text-[11px] font-medium text-primary bg-primary/10 px-2 py-1 rounded-md whitespace-nowrap">
                        {selectedCount} selected
                    </span>
                )}
                <div className="flex items-center px-2 py-1 bg-surface/50 rounded text-[10px] font-mono text-text-muted whitespace-nowrap border border-border/30">
                    <span className="font-bold text-text-main mr-1">{filteredCount}</span> CARDS
                </div>
            </div>
        </div>
    );
});