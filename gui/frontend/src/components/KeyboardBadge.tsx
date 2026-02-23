import { ReactNode } from 'react';
import { twMerge } from 'tailwind-merge';

interface KeyboardBadgeProps {
    shortcut: string;
    className?: string;
}

export function KeyboardBadge({ shortcut, className }: KeyboardBadgeProps) {
    return (
        <span
            className={twMerge(
                'inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-surface/80 border border-border text-text-muted font-mono select-none',
                className
            )}
        >
            {shortcut}
        </span>
    );
}