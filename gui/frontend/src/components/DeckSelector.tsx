import { useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Plus, Folder, FolderOpen, Search, X } from 'lucide-react';
import { clsx } from 'clsx';
import { KeyboardBadge } from './KeyboardBadge';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeckNode {
    name: string;      // "Math"
    fullName: string;  // "Uni::Math"
    children: Record<string, DeckNode>;
    hasCards: boolean;
}

export interface DeckSelectorProps {
    value: string;
    availableDecks: string[];
    isLoading: boolean;
    isOpen: boolean;
    searchQuery: string;
    expandedNodes: Set<string>;
    disabled?: boolean;
    onChange: (name: string) => void;
    onCreate: (name: string) => Promise<boolean>;
    onOpenChange: (open: boolean) => void;
    onSearchChange: (query: string) => void;
    onToggleNode: (nodeName: string) => void;
    onSearchMatchesChange?: (matchedFullNames: Set<string>) => void;
}

// ---------------------------------------------------------------------------
// Tree building utilities (pure functions)
// ---------------------------------------------------------------------------

const buildDeckTree = (decks: string[]): Record<string, DeckNode> => {
    const root: Record<string, DeckNode> = {};

    decks.forEach(deck => {
        const parts = deck.split('::');
        let currentLevel = root;
        let currentPath = '';

        parts.forEach((part, index) => {
            currentPath = currentPath ? `${currentPath}::${part}` : part;

            if (!currentLevel[part]) {
                currentLevel[part] = {
                    name: part,
                    fullName: currentPath,
                    children: {},
                    hasCards: index === parts.length - 1
                };
            }

            currentLevel = currentLevel[part].children;
        });
    });

    return root;
};

// Highlight matching text in a string
const HighlightMatch: React.FC<{ text: string; query: string }> = ({ text, query }) => {
    if (!query) return <>{text}</>;

    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const index = lowerText.indexOf(lowerQuery);

    if (index === -1) return <>{text}</>;

    const before = text.slice(0, index);
    const match = text.slice(index, index + query.length);
    const after = text.slice(index + query.length);

    return (
        <>
            {before}
            <mark className="bg-primary/30 text-inherit rounded px-0.5">{match}</mark>
            {after}
        </>
    );
};

// Recursive tree node component (avoids self-referential useCallback)
interface DeckTreeNodeProps {
    node: DeckNode;
    level: number;
    value: string;
    searchQuery: string;
    expandedNodes: Set<string>;
    onSelect: (name: string) => void;
    onToggleNode: (nodeName: string) => void;
}

function DeckTreeNode({
    node,
    level,
    value,
    searchQuery,
    expandedNodes,
    onSelect,
    onToggleNode,
}: DeckTreeNodeProps) {
    const isExpanded = expandedNodes.has(node.fullName);
    const isSelected = value === node.fullName;
    const hasChildren = Object.keys(node.children).length > 0;

    return (
        <div className="select-none">
            <div
                className={clsx(
                    'flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors',
                    isSelected ? 'bg-primary/10 text-primary' : 'text-text-muted hover:bg-surface hover:text-text-main',
                    level > 0 && 'ml-4 border-l border-border/30'
                )}
                onClick={(e) => {
                    e.stopPropagation();
                    onSelect(node.fullName);
                }}
            >
                {hasChildren && (
                    <div
                        className="p-1 hover:bg-black/5 rounded"
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggleNode(node.fullName);
                        }}
                    >
                        {isExpanded ? <FolderOpen className="w-3 h-3" /> : <Folder className="w-3 h-3" />}
                    </div>
                )}
                {!hasChildren && <div className="w-5" />}

                <span className="flex-1 text-sm truncate">
                    <HighlightMatch text={node.name} query={searchQuery} />
                </span>
                {isSelected && <Check className="w-3 h-3" />}
            </div>

            {hasChildren && isExpanded && (
                <div className="ml-2">
                    {Object.values(node.children)
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map((child) => (
                            <DeckTreeNode
                                key={child.fullName}
                                node={child}
                                level={level + 1}
                                value={value}
                                searchQuery={searchQuery}
                                expandedNodes={expandedNodes}
                                onSelect={onSelect}
                                onToggleNode={onToggleNode}
                            />
                        ))}
                </div>
            )}
        </div>
    );
}

// Collect all full names in a subtree
const collectAllFullNames = (node: DeckNode): Set<string> => {
    const names = new Set<string>();
    names.add(node.fullName);
    Object.values(node.children).forEach(child => {
        collectAllFullNames(child).forEach(name => names.add(name));
    });
    return names;
};

// Filter tree nodes based on search query
const filterTreeBySearch = (
    tree: Record<string, DeckNode>,
    query: string
): { filteredTree: Record<string, DeckNode>; matchedFullNames: Set<string> } => {
    if (!query.trim()) {
        return { filteredTree: tree, matchedFullNames: new Set() };
    }

    const lowerQuery = query.toLowerCase();
    const matchedFullNames = new Set<string>();

    const matchesDeck = (fullName: string): boolean => {
        return fullName.toLowerCase().includes(lowerQuery);
    };

    const filterNode = (node: DeckNode): DeckNode | null => {
        const nodeMatches = matchesDeck(node.fullName);

        if (nodeMatches) {
            collectAllFullNames(node).forEach(name => matchedFullNames.add(name));
            return { ...node };
        }

        const filteredChildren: Record<string, DeckNode> = {};
        Object.entries(node.children).forEach(([key, child]) => {
            const filteredChild = filterNode(child);
            if (filteredChild) {
                filteredChildren[key] = filteredChild;
                matchedFullNames.add(node.fullName);
            }
        });

        if (Object.keys(filteredChildren).length > 0) {
            matchedFullNames.add(node.fullName);
            return { ...node, children: filteredChildren };
        }

        return null;
    };

    const filteredTree: Record<string, DeckNode> = {};
    Object.entries(tree).forEach(([key, node]) => {
        const filteredNode = filterNode(node);
        if (filteredNode) {
            filteredTree[key] = filteredNode;
        }
    });

    return { filteredTree, matchedFullNames };
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DeckSelector({
    value,
    availableDecks,
    isLoading,
    isOpen,
    searchQuery,
    expandedNodes,
    disabled,
    onChange,
    onCreate,
    onOpenChange,
    onSearchChange,
    onToggleNode,
    onSearchMatchesChange,
}: DeckSelectorProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Handle click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                onOpenChange(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [onOpenChange]);

    // Tree generation (guard against undefined from tests/legacy)
    const deckTree = useMemo(() => buildDeckTree([...(availableDecks ?? [])].sort()), [availableDecks]);

    // Filtered tree based on search query
    const { filteredTree, matchedFullNames } = useMemo(() => {
        return filterTreeBySearch(deckTree, searchQuery);
    }, [deckTree, searchQuery]);

    useEffect(() => {
        onSearchMatchesChange?.(matchedFullNames);
    }, [matchedFullNames, onSearchMatchesChange]);

    // Handle selection
    const handleSelect = (deckName: string) => {
        onChange(deckName);
        onOpenChange(false);
    };

    // Handle input change
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        onChange(e.target.value);
        onOpenChange(true);
    };

    // Handle create deck on blur or enter
    const handleCreateDeck = async () => {
        const trimmed = value.trim();
        if (!trimmed) return;

        // Basic validation
        if (trimmed.includes('"') || trimmed.startsWith('::') || trimmed.endsWith('::')) {
            return;
        }

        const success = await onCreate(trimmed);
        if (success) {
            handleSelect(trimmed);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleCreateDeck();
            onOpenChange(false);
            inputRef.current?.blur();
        }
    };

    const hasFilteredResults = Object.keys(filteredTree).length > 0;
    const isNewDeck = value && !availableDecks.includes(value);

    return (
        <div ref={containerRef} className="relative group">
            <div className="relative">
                <input
                    ref={inputRef}
                    type="text"
                    value={value}
                    onChange={handleInputChange}
                    onFocus={() => onOpenChange(true)}
                    onBlur={() => {
                        setTimeout(() => handleCreateDeck(), 200);
                    }}
                    onKeyDown={handleKeyDown}
                    disabled={disabled}
                    placeholder="University::Subject::Topic"
                    className="w-full bg-surface/50 border-0 rounded-xl py-4 px-5 pl-12 text-lg focus:ring-2 focus:ring-primary/50 outline-none transition-all placeholder:text-text-muted"
                />
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted">
                    <Folder className="w-5 h-5" />
                </div>

                <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                    <KeyboardBadge shortcut="⌘K" className="text-xs" />
                </div>

                {isLoading && (
                    <div className="absolute right-4 top-1/2 -translate-y-1/2">
                        <motion.div
                            animate={{ rotate: 360 }}
                            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                            className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full"
                        />
                    </div>
                )}
            </div>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        transition={{ duration: 0.1 }}
                        className="absolute z-50 w-full mt-2 bg-surface/95 backdrop-blur-xl border border-border rounded-xl shadow-xl max-h-[400px] overflow-y-auto overflow-x-hidden"
                    >
                        {/* Search Input */}
                        <div className="sticky top-0 bg-surface/95 backdrop-blur-xl border-b border-border/50 p-2 z-10">
                            <div className="relative">
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => onSearchChange(e.target.value)}
                                    placeholder="Search decks..."
                                    className="w-full bg-background/50 border border-border/50 rounded-lg py-2 pl-9 pr-8 text-sm focus:ring-2 focus:ring-primary/30 focus:border-primary/30 outline-none transition-all placeholder:text-text-muted"
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                        }
                                    }}
                                />
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                                {searchQuery && (
                                    <button
                                        onClick={() => onSearchChange('')}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-black/5 rounded text-text-muted hover:text-text-main transition-colors"
                                    >
                                        <X className="w-3 h-3" />
                                    </button>
                                )}
                            </div>
                        </div>

                        {isNewDeck && (
                            <div
                                className="px-4 py-3 border-b border-border/50 text-sm text-primary flex items-center gap-2 cursor-pointer hover:bg-primary/5"
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    handleCreateDeck();
                                }}
                            >
                                <Plus className="w-4 h-4" />
                                <span>Create new deck "<strong>{value}</strong>"</span>
                            </div>
                        )}

                        <div className="py-2">
                            {hasFilteredResults ? (
                                Object.values(filteredTree)
                                    .sort((a, b) => a.name.localeCompare(b.name))
                                    .map((node) => (
                                        <DeckTreeNode
                                            key={node.fullName}
                                            node={node}
                                            level={0}
                                            value={value}
                                            searchQuery={searchQuery}
                                            expandedNodes={expandedNodes}
                                            onSelect={handleSelect}
                                            onToggleNode={onToggleNode}
                                        />
                                    ))
                            ) : (
                                searchQuery && (
                                    <div className="px-4 py-8 text-center text-text-muted text-sm">
                                        No matching decks
                                    </div>
                                )
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
