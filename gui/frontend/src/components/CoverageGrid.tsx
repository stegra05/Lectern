import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { clsx } from 'clsx';
import type { Card, CoverageData } from '../api';
import { deriveMaxSlideNumber, getCardPageReferences } from '../utils/cardMetadata';

interface CoverageGridProps {
    totalPages: number;
    cards: Card[];
    coverageData?: CoverageData | null;
    activePage?: number | null;
    onPageClick?: (page: number) => void;
}

export function CoverageGrid({ totalPages, cards, coverageData, activePage, onPageClick }: CoverageGridProps) {
    const effectiveTotalPages = useMemo(
        () => Math.max(totalPages, deriveMaxSlideNumber(cards)),
        [cards, totalPages]
    );

    // 1. Map page -> count
    const coverageMap = useMemo(() => {
        const map = new Map<number, number>();
        cards.forEach(card => {
            getCardPageReferences(card).forEach(page => {
                map.set(page, (map.get(page) || 0) + 1);
            });
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
    const conceptSummary = useMemo(() => {
        const concepts = coverageData?.concept_catalog || [];
        if (!concepts.length) {
            return null;
        }

        const coveredPagesByCard = cards.map(getCardPageReferences);
        const explicitConceptIds = new Set<string>();
        const coveredConceptIds = new Set<string>();

        cards.forEach(card => {
            (card.concept_ids || []).forEach(id => {
                if (typeof id === 'string' && id.trim()) {
                    explicitConceptIds.add(id.trim());
                }
            });
        });

        concepts.forEach(concept => {
            if (explicitConceptIds.has(concept.id)) {
                coveredConceptIds.add(concept.id);
                return;
            }
            const conceptPages = new Set((concept.page_references || []).filter(page => Number.isInteger(page) && page > 0));
            if (conceptPages.size === 0) {
                return;
            }
            const hasOverlap = coveredPagesByCard.some(cardPages => cardPages.some(page => conceptPages.has(page)));
            if (hasOverlap) {
                coveredConceptIds.add(concept.id);
            }
        });

        const highPriority = concepts.filter(concept => concept.importance === 'high');
        const highPriorityCovered = highPriority.filter(concept => coveredConceptIds.has(concept.id)).length;
        const coveredConceptNames = concepts
            .filter((concept) => coveredConceptIds.has(concept.id))
            .map((concept) => concept.name || concept.id)
            .filter((value) => Boolean(value));
        const missingHighPriorityNames = (coverageData?.missing_high_priority || [])
            .map((concept) => concept.name || concept.id)
            .filter((value) => Boolean(value));
        const uncoveredConceptNames = (coverageData?.uncovered_concepts || [])
            .map((concept) => concept.name || concept.id)
            .filter((value) => Boolean(value));
        const uncoveredRelationNames = (coverageData?.uncovered_relations || [])
            .map((relation) => {
                const source = typeof relation.source === 'string' ? relation.source : '';
                const relType = typeof relation.type === 'string' ? relation.type : '';
                const target = typeof relation.target === 'string' ? relation.target : '';
                if (source && relType && target) return `${source} ${relType} ${target}`;
                return typeof relation.key === 'string' ? relation.key : '';
            })
            .filter((value) => Boolean(value));

        return {
            total: concepts.length,
            covered: coveredConceptIds.size,
            pct: Math.round((coveredConceptIds.size / concepts.length) * 100),
            highPriorityTotal: highPriority.length,
            highPriorityCovered,
            coveredConceptNames,
            missingHighPriorityNames,
            uncoveredConceptNames,
            uncoveredRelationNames,
        };
    }, [cards, coverageData]);

    if (effectiveTotalPages === 0) return null;

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted">
                    Page Coverage
                </h3>
                <div className="flex items-center gap-2">
                    {conceptSummary && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border bg-surface text-text-muted border-border">
                            Concepts {conceptSummary.covered}/{conceptSummary.total} ({conceptSummary.pct}%)
                        </span>
                    )}
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

            {conceptSummary && (
                <div className="flex items-center justify-between rounded border border-border bg-surface/60 px-2 py-1 text-[10px] text-text-muted">
                    <span>Concept Coverage</span>
                    <span className="font-mono">
                        High Priority {conceptSummary.highPriorityCovered}/{conceptSummary.highPriorityTotal}
                    </span>
                </div>
            )}

            {conceptSummary && (
                <details className="rounded border border-border bg-surface/50 px-2 py-2 text-[11px] text-text-muted">
                    <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-wider">
                        Coverage Details
                    </summary>
                    <div className="mt-2 space-y-2">
                        <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Covered concepts</p>
                            <p className="text-text-main">
                                {conceptSummary.coveredConceptNames.length > 0
                                    ? conceptSummary.coveredConceptNames.join(', ')
                                    : 'None'}
                            </p>
                        </div>
                        <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Missing high-priority</p>
                            <p className="text-text-main">
                                {conceptSummary.missingHighPriorityNames.length > 0
                                    ? conceptSummary.missingHighPriorityNames.join(', ')
                                    : 'None'}
                            </p>
                        </div>
                        <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Uncovered concepts</p>
                            <p className="text-text-main">
                                {conceptSummary.uncoveredConceptNames.length > 0
                                    ? conceptSummary.uncoveredConceptNames.join(', ')
                                    : 'None'}
                            </p>
                        </div>
                        <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Uncovered relations</p>
                            <p className="text-text-main">
                                {conceptSummary.uncoveredRelationNames.length > 0
                                    ? conceptSummary.uncoveredRelationNames.join(', ')
                                    : 'None'}
                            </p>
                        </div>
                    </div>
                </details>
            )}

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
                                        : "bg-surface text-text-muted/60 border-transparent hover:border-border hover:text-text-main hover:bg-surface/80"
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
