import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Plus, Folder, FolderOpen } from 'lucide-react';
import { clsx } from 'clsx';
import { api } from '../api';

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



export function DeckSelector({ value, onChange, disabled }: DeckSelectorProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [inputValue, setInputValue] = useState(value);
    const [availableDecks, setAvailableDecks] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Initial load & caching
    useEffect(() => {
        // Load cached decks first for instant UI
        const cached = localStorage.getItem('lectern_cached_decks');
        if (cached) {
            try {
                setAvailableDecks(JSON.parse(cached));
            } catch (e) {
                console.error('Failed to parse cached decks', e);
            }
        }

        // Load last used deck if no value provided
        if (!value) {
            const lastUsed = localStorage.getItem('lectern_last_deck');
            if (lastUsed) {
                onChange(lastUsed);
                setInputValue(lastUsed);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Fetch decks (background update)
    const fetchDecks = async () => {
        if (isLoading) return;
        setIsLoading(true);
        try {
            const res = await api.getDecks();
            if (res.decks && Array.isArray(res.decks)) {
                setAvailableDecks(res.decks);
                localStorage.setItem('lectern_cached_decks', JSON.stringify(res.decks));
            }
        } finally {
            setIsLoading(false);
        }
    };

    // Update input when value prop changes
    useEffect(() => {
        setInputValue(value);
    }, [value]);

    // Persist selection
    const handleSelect = (deckName: string) => {
        onChange(deckName);
        setInputValue(deckName);
        setIsOpen(false);
        localStorage.setItem('lectern_last_deck', deckName);
    };

    // Handle input change
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = e.target.value;
        setInputValue(newValue);
        onChange(newValue);
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
        const trimmed = inputValue.trim();
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

                // Update cache
                localStorage.setItem('lectern_cached_decks', JSON.stringify(newDecks));
            } catch (e) {
                console.error('Failed to create deck', e);
                // Revert if failed (optional, but good UX)
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

    // Filtered decks for flat list view (fallback/search)
    const filteredDecks = useMemo(() => {
        if (!inputValue) return availableDecks;
        return availableDecks.filter(d =>
            d.toLowerCase().includes(inputValue.toLowerCase())
        );
    }, [availableDecks, inputValue]);

    // Tree generation for dropdown
    const deckTree = useMemo(() => buildDeckTree(availableDecks.sort()), [availableDecks]);

    // Recursive tree renderer
    const renderNode = (node: DeckNode, level: number = 0) => {
        const isExpanded = expandedNodes.has(node.fullName);
        const isSelected = value === node.fullName;
        const hasChildren = Object.keys(node.children).length > 0;

        // If searching, show only matching nodes in a flat-ish way or expand relevant branches?
        // For simplicity: if searching, we fallback to flat list in the main render.
        // The tree view is best for exploring when input is empty or just browsing.

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
                        // If it has children, toggle expand. If it's also a valid deck (leaf or intermediate with cards), select it?
                        // In Anki, intermediate nodes can be decks. We'll allow selecting any node.
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
                    {!hasChildren && <div className="w-5" />} {/* Spacer */}

                    <span className="flex-1 text-sm truncate">{node.name}</span>
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
    };

    const isNewDeck = inputValue && !availableDecks.includes(inputValue);

    return (
        <div ref={containerRef} className="relative group">
            <div className="relative">
                <input
                    ref={inputRef}
                    type="text"
                    value={inputValue}
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
                    className="w-full bg-surface/50 border border-border rounded-xl py-4 px-5 pl-12 text-lg focus:ring-2 focus:ring-primary/50 focus:border-primary/50 outline-none transition-all placeholder:text-text-muted"
                />
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted">
                    <Folder className="w-5 h-5" />
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
                        className="absolute z-50 w-full mt-2 bg-surface/95 backdrop-blur-xl border border-border rounded-xl shadow-xl max-h-[300px] overflow-y-auto overflow-x-hidden"
                    >
                        {isNewDeck && (
                            <div
                                className="px-4 py-3 border-b border-border/50 text-sm text-primary flex items-center gap-2 cursor-pointer hover:bg-primary/5"
                                onMouseDown={(e) => {
                                    e.preventDefault(); // Prevent blur
                                    handleCreateDeck();
                                }}
                            >
                                <Plus className="w-4 h-4" />
                                <span>Create new deck "<strong>{inputValue}</strong>"</span>
                            </div>
                        )}

                        <div className="py-2">
                            {/* If searching, show flat list. If empty input, show tree. */}
                            {inputValue ? (
                                filteredDecks.length > 0 ? (
                                    filteredDecks.map(deck => (
                                        <div
                                            key={deck}
                                            className={clsx(
                                                "px-4 py-2 text-sm cursor-pointer hover:bg-surface hover:text-text-main flex items-center gap-2",
                                                value === deck ? "bg-primary/10 text-primary" : "text-text-muted"
                                            )}
                                            onMouseDown={(e) => {
                                                e.preventDefault();
                                                handleSelect(deck);
                                            }}
                                        >
                                            <Folder className="w-4 h-4 opacity-50" />
                                            <span className="truncate">{deck}</span>
                                            {value === deck && <Check className="w-3 h-3 ml-auto" />}
                                        </div>
                                    ))
                                ) : (
                                    !isNewDeck && (
                                        <div className="px-4 py-8 text-center text-text-muted text-sm">
                                            No matching decks found.
                                        </div>
                                    )
                                )
                            ) : (
                                Object.values(deckTree)
                                    .sort((a, b) => a.name.localeCompare(b.name))
                                    .map(node => renderNode(node))
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
