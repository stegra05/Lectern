import { useEffect, useCallback, useRef } from 'react';

export interface KeyboardShortcut {
    key: string;
    description: string;
    category: 'navigation' | 'editing' | 'general';
    modifier?: 'cmd' | 'ctrl' | 'shift' | 'alt';
}

export const SHORTCUTS: KeyboardShortcut[] = [
    { key: 's', description: 'Save current edit', category: 'editing', modifier: 'cmd' },
    { key: 'f', description: 'Focus search', category: 'navigation', modifier: 'cmd' },
    { key: 'k', description: 'Open deck selector', category: 'navigation', modifier: 'cmd' },
    { key: 'Escape', description: 'Close modals / Cancel edit', category: 'general' },
    { key: '?', description: 'Show keyboard shortcuts', category: 'general' },
    { key: 'Delete', description: 'Remove selected card', category: 'editing' },
    { key: 'Backspace', description: 'Remove selected card', category: 'editing' },
];

interface UseKeyboardShortcutsProps {
    // Modal controls
    isSettingsOpen: boolean;
    setIsSettingsOpen: (open: boolean) => void;
    isHistoryOpen: boolean;
    setIsHistoryOpen: (open: boolean) => void;
    isShortcutsModalOpen: boolean;
    setIsShortcutsModalOpen: (open: boolean) => void;

    // Search control
    focusSearch: () => void;

    // Deck selector control
    focusDeckSelector: () => void;

    // Edit controls
    isEditing: boolean;
    saveEdit: () => void;
    cancelEdit: () => void;

    // Card deletion (when not editing text)
    selectedCardIndex: number | null;
    deleteCard: (index: number) => void;
}

/**
 * Checks if the current keyboard event target is an input field where
 * we should not intercept keyboard shortcuts.
 */
function isInputElement(target: EventTarget | null): boolean {
    if (!target || !(target instanceof HTMLElement)) {
        return false;
    }

    const tagName = target.tagName.toLowerCase();
    const isEditable = target.isContentEditable;
    const isInput = tagName === 'input' || tagName === 'textarea' || tagName === 'select';

    return isInput || isEditable;
}

/**
 * Custom hook for managing keyboard shortcuts throughout the application.
 * Handles common shortcuts like Cmd+S for save, Cmd+F for search, etc.
 */
export function useKeyboardShortcuts({
    isSettingsOpen,
    setIsSettingsOpen,
    isHistoryOpen,
    setIsHistoryOpen,
    isShortcutsModalOpen,
    setIsShortcutsModalOpen,
    focusSearch,
    focusDeckSelector,
    isEditing,
    saveEdit,
    cancelEdit,
    selectedCardIndex,
    deleteCard,
}: UseKeyboardShortcutsProps): KeyboardShortcut[] {
    // Track if we've already handled the event to prevent double-firing
    const lastKeyTime = useRef<number>(0);

    const handleKeyDown = useCallback((event: KeyboardEvent) => {
        const now = Date.now();
        // Debounce rapid key repeats
        if (now - lastKeyTime.current < 50) {
            return;
        }
        lastKeyTime.current = now;

        const target = event.target;
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        const cmdKey = isMac ? event.metaKey : event.ctrlKey;

        // Helper to check if any modal is open
        const anyModalOpen = isSettingsOpen || isHistoryOpen || isShortcutsModalOpen;

        // -----------------------------------------------------------------------
        // Escape key - Close modals / Cancel edit
        // -----------------------------------------------------------------------
        if (event.key === 'Escape') {
            // First priority: cancel editing
            if (isEditing) {
                event.preventDefault();
                cancelEdit();
                return;
            }

            // Second priority: close shortcuts modal
            if (isShortcutsModalOpen) {
                event.preventDefault();
                setIsShortcutsModalOpen(false);
                return;
            }

            // Third priority: close other modals
            if (isSettingsOpen) {
                event.preventDefault();
                setIsSettingsOpen(false);
                return;
            }

            if (isHistoryOpen) {
                event.preventDefault();
                setIsHistoryOpen(false);
                return;
            }

            return;
        }

        // -----------------------------------------------------------------------
        // Question mark - Show keyboard shortcuts
        // -----------------------------------------------------------------------
        if (event.key === '?' || (event.shiftKey && event.key === '/')) {
            // Allow toggling shortcuts modal even when typing if it's already open
            if (isShortcutsModalOpen) {
                event.preventDefault();
                setIsShortcutsModalOpen(false);
                return;
            }

            // Only show shortcuts if not in an input field
            if (!isInputElement(target)) {
                event.preventDefault();
                setIsShortcutsModalOpen(true);
                return;
            }
        }

        // For all other shortcuts, don't intercept if user is typing
        if (isInputElement(target)) {
            return;
        }

        // -----------------------------------------------------------------------
        // Cmd/Ctrl + S - Save current edit
        // -----------------------------------------------------------------------
        if (cmdKey && event.key.toLowerCase() === 's') {
            if (isEditing) {
                event.preventDefault();
                saveEdit();
            }
            return;
        }

        // -----------------------------------------------------------------------
        // Cmd/Ctrl + F - Focus search
        // -----------------------------------------------------------------------
        if (cmdKey && event.key.toLowerCase() === 'f') {
            event.preventDefault();
            focusSearch();
            return;
        }

        // -----------------------------------------------------------------------
        // Cmd/Ctrl + K - Open deck selector
        // -----------------------------------------------------------------------
        if (cmdKey && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            focusDeckSelector();
            return;
        }

        // -----------------------------------------------------------------------
        // Delete/Backspace - Remove selected card (only when not editing)
        // -----------------------------------------------------------------------
        if ((event.key === 'Delete' || event.key === 'Backspace') && !isEditing) {
            if (selectedCardIndex !== null && selectedCardIndex >= 0) {
                event.preventDefault();
                deleteCard(selectedCardIndex);
            }
            return;
        }
    }, [
        isSettingsOpen,
        setIsSettingsOpen,
        isHistoryOpen,
        setIsHistoryOpen,
        isShortcutsModalOpen,
        setIsShortcutsModalOpen,
        focusSearch,
        focusDeckSelector,
        isEditing,
        saveEdit,
        cancelEdit,
        selectedCardIndex,
        deleteCard,
    ]);

    useEffect(() => {
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [handleKeyDown]);

    return SHORTCUTS;
}
