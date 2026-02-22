import { useEffect, useCallback, useRef } from 'react';

/**
 * List of focusable element selectors
 */
const FOCUSABLE_SELECTORS = [
    'a[href]',
    'button:not([disabled])',
    'textarea:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(', ');

interface UseFocusTrapOptions {
    /** Whether the focus trap is active */
    isActive: boolean;
    /** Callback when Escape key is pressed (optional) */
    onEscape?: () => void;
    /** Whether to auto-focus the first element when activated (default: true) */
    autoFocus?: boolean;
    /** Callback to restore focus when trap is deactivated (receives the element to restore) */
    restoreFocus?: boolean;
}

/**
 * Custom hook to trap focus within a container element.
 * Useful for modals, dialogs, and other overlay components.
 *
 * @example
 * ```tsx
 * const containerRef = useRef<HTMLDivElement>(null);
 * const previousActiveElement = useRef<HTMLElement | null>(null);
 *
 * useFocusTrap({
 *     ref: containerRef,
 *     isActive: isOpen,
 *     onEscape: () => setIsOpen(false),
 * });
 *
 * // Store the element that opened the modal
 * const handleOpen = () => {
 *     previousActiveElement.current = document.activeElement as HTMLElement;
 *     setIsOpen(true);
 * };
 *
 * // Restore focus when closing
 * const handleClose = () => {
 *     setIsOpen(false);
 *     previousActiveElement.current?.focus();
 * };
 * ```
 */
export function useFocusTrap<T extends HTMLElement>(
    ref: React.RefObject<T>,
    options: UseFocusTrapOptions
) {
    const { isActive, onEscape, autoFocus = true, restoreFocus = true } = options;
    const previousActiveElement = useRef<HTMLElement | null>(null);

    // Get all focusable elements within the container
    const getFocusableElements = useCallback(() => {
        if (!ref.current) return [];
        return Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS))
            .filter(el => el.offsetParent !== null); // Filter out hidden elements
    }, [ref]);

    // Handle keyboard events
    const handleKeyDown = useCallback((event: KeyboardEvent) => {
        if (!isActive || !ref.current) return;

        // Handle Escape key
        if (event.key === 'Escape' && onEscape) {
            event.preventDefault();
            onEscape();
            return;
        }

        // Handle Tab key for focus trapping
        if (event.key === 'Tab') {
            const focusableElements = getFocusableElements();
            if (focusableElements.length === 0) {
                event.preventDefault();
                return;
            }

            const firstElement = focusableElements[0];
            const lastElement = focusableElements[focusableElements.length - 1];

            // If Shift+Tab on first element, go to last
            if (event.shiftKey && document.activeElement === firstElement) {
                event.preventDefault();
                lastElement.focus();
                return;
            }

            // If Tab on last element, go to first
            if (!event.shiftKey && document.activeElement === lastElement) {
                event.preventDefault();
                firstElement.focus();
                return;
            }
        }
    }, [isActive, ref, getFocusableElements, onEscape]);

    // Set up event listeners and handle focus
    useEffect(() => {
        if (!isActive) {
            // Restore focus when trap is deactivated
            if (restoreFocus && previousActiveElement.current) {
                previousActiveElement.current.focus();
                previousActiveElement.current = null;
            }
            return;
        }

        // Store the currently focused element to restore later
        if (restoreFocus && document.activeElement instanceof HTMLElement) {
            previousActiveElement.current = document.activeElement;
        }

        // Add keyboard event listener
        document.addEventListener('keydown', handleKeyDown);

        // Auto-focus first focusable element
        if (autoFocus) {
            // Use requestAnimationFrame to ensure DOM is ready
            requestAnimationFrame(() => {
                const focusableElements = getFocusableElements();
                if (focusableElements.length > 0) {
                    // Try to find an element with autofocus attribute first
                    const autofocusElement = focusableElements.find(
                        el => el.hasAttribute('autofocus')
                    );
                    if (autofocusElement) {
                        autofocusElement.focus();
                    } else {
                        focusableElements[0].focus();
                    }
                }
            });
        }

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isActive, handleKeyDown, autoFocus, getFocusableElements, restoreFocus]);

    return { previousActiveElement };
}

/**
 * Helper function to generate a unique ID for aria-labelledby
 */
let idCounter = 0;
export function generateAriaId(prefix: string = 'aria'): string {
    return `${prefix}-${++idCounter}`;
}
