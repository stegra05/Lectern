import React from 'react';

import { twMerge } from 'tailwind-merge';

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
    children: React.ReactNode;
}

export const GlassCard: React.FC<GlassCardProps> = ({ children, className, ...props }) => {
    return (
        <div
            className={twMerge(
                "bg-zinc-900/40 backdrop-blur-md border border-zinc-800 rounded-2xl shadow-2xl p-6",
                className
            )}
            {...props}
        >
            {children}
        </div>
    );
};
