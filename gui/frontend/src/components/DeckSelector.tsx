import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Plus, Folder, FolderOpen, Search, X } from 'lucide-react';
import { clsx } from 'clsx';
import { api } from '../api';
import { KeyboardBadge } from './KeyboardBadge';
import { useLecternStore } from '../store';

interface DeckSelectorProps {
    value: string;
    onChange: (name: string) => void;
    disabled?: boolean;
}

interface DeckNode {
    name: string;      // "Math"
    fullName: string;  // "Uni::Math"
    children: Record<string, DeckNode>;
    hasCards: boolean; // In a real app we'd check this, here assume leaf nodes are decks
}

// Parse flat list of decks into a tree
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

// Collect all full names in a subtree (for parent matches, we need to show all descendants)
const collectAllFullNames = (node: DeckNode): Set<string> => {
    const names = new Set<string>();
    names.add(node.fullName);
    Object.values(node.children).forEach(child => {
        collectAllFullNames(child).forEach(name => names.add(name));
    });
    return names;
};

// Filter tree nodes based on search query, preserving paths to matches
const filterTreeBySearch = (
    tree: Record<string, DeckNode>,
    query: string
): { filteredTree: Record<string, DeckNode>; matchedFullNames: Set<string> } => {
    if (!query.trim()) {
        return { filteredTree: tree, matchedFullNames: new Set() };
    }

    const lowerQuery = query.toLowerCase();
    const matchedFullNames = new Set<string>();

    // First pass: find all decks that match (by full name or partial name)
    const matchesDeck = (fullName: string): boolean => {
        return fullName.toLowerCase().includes(lowerQuery);
    };


    // Clone a node, filtering children and marking matched paths
    const filterNode = (node: DeckNode): DeckNode | null => {
        const nodeMatches = matchesDeck(node.fullName);

        // If this node matches, include all its descendants
        if (nodeMatches) {
            collectAllFullNames(node).forEach(name => matchedFullNames.add(name));
            return { ...node }; // Return node with all children intact
        }

        // Otherwise, filter children
        const filteredChildren: Record<string, DeckNode> = {};
        Object.entries(node.children).forEach(([key, child]) => {
            const filteredChild = filterNode(child);
            if (filteredChild) {
                filteredChildren[key] = filteredChild;
                // Mark parent path as needed
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



export function DeckSelector({ value, onChange, disabled }: DeckSelectorProps) {
    const [isOpen, setIsOpen] = useState(false);
    const availableDecks = useLecternStore((s) => s.availableDecks);
    const setAvailableDecks = useLecternStore((s) => s.setAvailableDecks);
    const [isLoading, setIsLoading] = useState(false);
    const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    // Fetch decks (background update)
    const fetchDecks = async () => {
        if (isLoading) return;
        setIsLoading(true);
        try {
            const res = await api.getDecks();
            if (res.decks && Array.isArray(res.decks)) {
                setAvailableDecks(res.decks);
            }
        } finally {
            setIsLoading(false);
        }
    };

    // Handle selection
    const handleSelect = useCallback((deckName: string) => {
        onChange(deckName);
        setIsOpen(false);
    }, [onChange]);

    // Handle input change
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        onChange(e.target.value);
        setIsOpen(true);
    };

    // Handle click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Create deck on blur or enter if it doesn't exist
    const handleCreateDeck = async () => {
        const trimmed = value.trim();
        if (!trimmed) return;

        // Basic validation
        if (trimmed.includes('"') || trimmed.startsWith('::') || trimmed.endsWith('::')) {
            return; // Invalid format
        }

        if (!availableDecks.includes(trimmed)) {
            // It's a new deck
            try {
                // Optimistic update
                const newDecks = [...availableDecks, trimmed].sort();
                setAvailableDecks(newDecks);

                await api.createDeck(trimmed);
                handleSelect(trimmed);
            } catch (e) {
                console.error('Failed to create deck', e);
                // Revert if failed
                setAvailableDecks(availableDecks.filter(d => d !== trimmed));
            }
        } else {
            handleSelect(trimmed);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleCreateDeck();
            setIsOpen(false);
            inputRef.current?.blur();
        }
    };



    // Tree generation for dropdown
    const deckTree = useMemo(() => buildDeckTree(availableDecks.sort()), [availableDecks]);

    // Filtered tree based on search query
    const { filteredTree, matchedFullNames } = useMemo(() => {
        return filterTreeBySearch(deckTree, searchQuery);
    }, [deckTree, searchQuery]);

    // Auto-expand matched nodes when searching
    useEffect(() => {
        if (searchQuery.trim() && matchedFullNames.size > 0) {
            setExpandedNodes(prev => {
                const next = new Set(prev);
                matchedFullNames.forEach(name => next.add(name));
                return next;
            });
        }
    }, [searchQuery, matchedFullNames]);

    // Clear search when dropdown closes
    useEffect(() => {
        if (!isOpen) {
            setSearchQuery('');
        }
    }, [isOpen]);

    // Recursive tree renderer with highlighting
    const renderNode = useCallback((node: DeckNode, level: number = 0) => {
        const isExpanded = expandedNodes.has(node.fullName);
        const isSelected = value === node.fullName;
        const hasChildren = Object.keys(node.children).length > 0;

        return (
            <div key={node.fullName} className="select-none">
                <div
                    className={clsx(
                        "flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors",
                        isSelected ? "bg-primary/10 text-primary" : "text-text-muted hover:bg-surface hover:text-text-main",
                        level > 0 && "ml-4 border-l border-border/30"
                    )}
                    onClick={(e) => {
                        e.stopPropagation();
                        handleSelect(node.fullName);
                    }}
                >
                    {hasChildren && (
                        <div
                            className="p-1 hover:bg-black/5 rounded"
                            onClick={(e) => {
                                e.stopPropagation();
                                const next = new Set(expandedNodes);
                                if (isExpanded) next.delete(node.fullName);
                                else next.add(node.fullName);
                                setExpandedNodes(next);
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
                            .map(child => renderNode(child, level + 1))}
                    </div>
                )}
            </div>
        );
    }, [expandedNodes, value, searchQuery, handleSelect]);

    // Check if filtered tree has any nodes
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
                    onFocus={() => {
                        setIsOpen(true);
                        fetchDecks();
                    }}
                    onBlur={() => {
                        // Delay hide to allow clicks
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
                                    ref={searchInputRef}
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search decks..."
                                    className="w-full bg-background/50 border border-border/50 rounded-lg py-2 pl-9 pr-8 text-sm focus:ring-2 focus:ring-primary/30 focus:border-primary/30 outline-none transition-all placeholder:text-text-muted"
                                    onKeyDown={(e) => {
                                        // Prevent closing dropdown on Enter in search
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                        }
                                    }}
                                />
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                                {searchQuery && (
                                    <button
                                        onClick={() => setSearchQuery('')}
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
                                    e.preventDefault(); // Prevent blur
                                    handleCreateDeck();
                                }}
                            >
                                <Plus className="w-4 h-4" />
                                <span>Create new deck "<strong>{value}</strong>"</span>
                            </div>
                        )}

                        <div className="py-2">
                            {/* Show filtered tree view always, with search highlighting */}
                            {hasFilteredResults ? (
                                Object.values(filteredTree)
                                    .sort((a, b) => a.name.localeCompare(b.name))
                                    .map(node => renderNode(node))
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
