import React from 'react';

import { twMerge } from 'tailwind-merge';

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
    children: React.ReactNode;
}

export const GlassCard: React.FC<GlassCardProps> = ({ children, className, ...props }) => {
    return (
        <div
            className={twMerge(
                "bg-gray-800/40 backdrop-blur-md border border-white/10 rounded-xl shadow-xl p-6",
                className
            )}
            {...props}
        >
            {children}
        </div>
    );
};
