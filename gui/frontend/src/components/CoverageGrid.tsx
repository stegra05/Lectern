import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { clsx } from 'clsx';
import type { Card } from '../api';
import { deriveMaxSlideNumber, getCardSlideNumber } from '../utils/cardMetadata';

interface CoverageGridProps {
    totalPages: number;
    cards: Card[];
    activePage?: number | null;
    onPageClick?: (page: number) => void;
}

export function CoverageGrid({ totalPages, cards, activePage, onPageClick }: CoverageGridProps) {
    const effectiveTotalPages = useMemo(
        () => Math.max(totalPages, deriveMaxSlideNumber(cards)),
        [cards, totalPages]
    );

    // 1. Map page -> count
    const coverageMap = useMemo(() => {
        const map = new Map<number, number>();
        cards.forEach(card => {
            const slideNumber = getCardSlideNumber(card);
            if (slideNumber !== null) {
                map.set(slideNumber, (map.get(slideNumber) || 0) + 1);
            }
        });
        return map;
    }, [cards]);

    // 2. Stats
    const coveredCount = useMemo(() => {
        let count = 0;
        for (let i = 1; i <= effectiveTotalPages; i++) {
            if (coverageMap.has(i)) count++;
        }
        return count;
    }, [coverageMap, effectiveTotalPages]);

    const coveragePct = effectiveTotalPages > 0 ? Math.round((coveredCount / effectiveTotalPages) * 100) : 0;

    if (effectiveTotalPages === 0) return null;

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted">
                    Page Coverage
                </h3>
                <div className="flex items-center gap-2">
                    {activePage && onPageClick && (
                        <button
                            onClick={() => onPageClick(activePage)} // Click again to clear
                            className="text-[10px] text-primary hover:text-primary/80 font-bold"
                        >
                            Clear Filter
                        </button>
                    )}
                    <span className={clsx(
                        "text-[10px] font-mono px-1.5 py-0.5 rounded border",
                        coveredCount === effectiveTotalPages
                            ? "bg-green-500/10 text-green-400 border-green-500/20"
                            : "bg-surface text-text-muted border-border"
                    )}>
                        {coveredCount}/{effectiveTotalPages} ({coveragePct}%)
                    </span>
                </div>
            </div>

            <div className="grid grid-cols-10 gap-1">
                {Array.from({ length: effectiveTotalPages }, (_, i) => i + 1).map((page, i) => {
                    const count = coverageMap.get(page) || 0;
                    const isCovered = count > 0;
                    const isActive = activePage === page;

                    return (
                        <motion.button
                            key={page}
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: isActive ? 1.05 : 1 }}
                            transition={{ delay: i * 0.005 }} // Stagger effect
                            onClick={() => onPageClick && onPageClick(page)}
                            className={clsx(
                                "aspect-square rounded flex items-center justify-center text-[10px] font-medium transition-all group relative border w-full",
                                isActive
                                    ? "bg-primary text-background border-primary hover:bg-primary/90 shadow-[0_0_10px_rgba(163,230,53,0.3)] z-10" // Active state
                                    : isCovered
                                        ? "bg-primary/20 text-primary border-primary/30 hover:bg-primary/30 hover:border-primary/50"
                                        : "bg-surface text-text-muted/30 border-transparent hover:border-border hover:text-text-muted hover:bg-surface/80"
                            )}
                            title={`Page ${page}: ${count} card${count !== 1 ? 's' : ''}`}
                            disabled={!onPageClick}
                        >
                            {page}

                            {/* Tooltip on hover */}
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-20 whitespace-nowrap bg-gray-900/90 text-white text-[10px] px-2 py-1 rounded pointer-events-none border border-gray-700">
                                Page {page}: {count} cards
                            </div>
                        </motion.button>
                    );
                })}
            </div>
        </div>
    );
}
