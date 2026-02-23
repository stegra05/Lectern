import React, { useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Keyboard, Edit3, Navigation, Settings } from 'lucide-react';
import type { KeyboardShortcut } from '../hooks/useKeyboardShortcuts';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface KeyboardShortcutsModalProps {
    isOpen: boolean;
    onClose: () => void;
    shortcuts: KeyboardShortcut[];
}

// Detect platform for displaying correct modifier key
const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;
const modKey = isMac ? 'Cmd' : 'Ctrl';

/**
 * Formats a keyboard shortcut for display, replacing modifier placeholders
 * with platform-appropriate keys.
 */
function formatKey(shortcut: KeyboardShortcut): string {
    if (shortcut.modifier === 'cmd') {
        return `${modKey} + ${shortcut.key.toUpperCase()}`;
    }
    if (shortcut.modifier === 'ctrl') {
        return `Ctrl + ${shortcut.key.toUpperCase()}`;
    }
    if (shortcut.modifier === 'shift') {
        return `Shift + ${shortcut.key.toUpperCase()}`;
    }
    if (shortcut.modifier === 'alt') {
        return isMac ? `Option + ${shortcut.key.toUpperCase()}` : `Alt + ${shortcut.key.toUpperCase()}`;
    }
    // Special formatting for common keys
    if (shortcut.key === 'Escape') return 'Esc';
    if (shortcut.key === 'Delete') return 'Delete';
    if (shortcut.key === 'Backspace') return 'Backspace';
    if (shortcut.key === '?') return '?';
    return shortcut.key.toUpperCase();
}

/**
 * Renders a styled keyboard key badge.
 */
const KeyBadge: React.FC<{ keyName: string }> = ({ keyName }) => (
    <span className="inline-flex items-center justify-center min-w-[28px] px-2 py-1 text-[11px] font-mono font-bold bg-surface border border-border rounded-md text-text-main shadow-sm">
        {keyName}
    </span>
);

interface ShortcutRowProps {
    shortcut: KeyboardShortcut;
}

const ShortcutRow: React.FC<ShortcutRowProps> = ({ shortcut }) => {
    const formattedKey = formatKey(shortcut);

    // Split multi-key shortcuts (e.g., "Cmd + S" -> ["Cmd", "+", "S"])
    const keyParts = formattedKey.split(' + ');

    return (
        <div className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-surface/50 transition-colors">
            <span className="text-sm text-text-muted">{shortcut.description}</span>
            <div className="flex items-center gap-1">
                {keyParts.map((part, index) => (
                    <React.Fragment key={index}>
                        <KeyBadge keyName={part} />
                        {index < keyParts.length - 1 && (
                            <span className="text-text-muted text-xs mx-0.5">+</span>
                        )}
                    </React.Fragment>
                ))}
            </div>
        </div>
    );
};

interface CategorySectionProps {
    title: string;
    icon: React.FC<{ className?: string }>;
    shortcuts: KeyboardShortcut[];
}

const CategorySection: React.FC<CategorySectionProps> = ({ title, icon: Icon, shortcuts }) => (
    <div className="space-y-2">
        <div className="flex items-center gap-2 px-3">
            <Icon className="w-4 h-4 text-primary" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted">{title}</h3>
        </div>
        <div className="space-y-1">
            {shortcuts.map((shortcut, index) => (
                <ShortcutRow key={`${shortcut.key}-${index}`} shortcut={shortcut} />
            ))}
        </div>
    </div>
);

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({
    isOpen,
    onClose,
    shortcuts,
}) => {
    const modalRef = useRef<HTMLDivElement>(null);
    const previousActiveElement = useRef<HTMLElement | null>(null);

    // Focus trap for accessibility
    useFocusTrap(modalRef, {
        isActive: isOpen,
        onEscape: onClose,
        autoFocus: true,
        restoreFocus: false,
    });

    // Store the element that opened the modal
    useEffect(() => {
        if (isOpen) {
            previousActiveElement.current = document.activeElement as HTMLElement;
        } else {
            previousActiveElement.current?.focus();
        }
    }, [isOpen]);

    // Group shortcuts by category
    const navigationShortcuts = shortcuts.filter(s => s.category === 'navigation');
    const editingShortcuts = shortcuts.filter(s => s.category === 'editing');
    const generalShortcuts = shortcuts.filter(s => s.category === 'general');

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
                        aria-hidden="true"
                    />

                    {/* Modal */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                        className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none p-4"
                    >
                        <div
                            ref={modalRef}
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="keyboard-shortcuts-title"
                            className="bg-surface border border-border w-full max-w-md rounded-2xl shadow-2xl pointer-events-auto overflow-hidden"
                        >
                            {/* Header */}
                            <div className="p-5 border-b border-border flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                                        <Keyboard className="w-4 h-4 text-primary" />
                                    </div>
                                    <div>
                                        <h2 id="keyboard-shortcuts-title" className="text-lg font-semibold text-text-main">
                                            Keyboard Shortcuts
                                        </h2>
                                        <p className="text-xs text-text-muted">
                                            Press <KeyBadge keyName="?" /> to toggle
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={onClose}
                                    aria-label="Close keyboard shortcuts"
                                    className="p-2 hover:bg-background rounded-lg text-text-muted hover:text-text-main transition-colors"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            {/* Content */}
                            <div className="p-4 space-y-5 max-h-[60vh] overflow-y-auto">
                                {/* Navigation */}
                                {navigationShortcuts.length > 0 && (
                                    <CategorySection
                                        title="Navigation"
                                        icon={Navigation}
                                        shortcuts={navigationShortcuts}
                                    />
                                )}

                                {/* Editing */}
                                {editingShortcuts.length > 0 && (
                                    <CategorySection
                                        title="Editing"
                                        icon={Edit3}
                                        shortcuts={editingShortcuts}
                                    />
                                )}

                                {/* General */}
                                {generalShortcuts.length > 0 && (
                                    <CategorySection
                                        title="General"
                                        icon={Settings}
                                        shortcuts={generalShortcuts}
                                    />
                                )}
                            </div>

                            {/* Footer */}
                            <div className="p-4 border-t border-border bg-surface/50">
                                <p className="text-xs text-text-muted text-center">
                                    {isMac
                                        ? 'Use Command (Cmd) key on Mac'
                                        : 'Use Control (Ctrl) key on Windows/Linux'}
                                </p>
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
};
