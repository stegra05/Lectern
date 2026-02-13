import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { clsx } from 'clsx';
import type { LucideIcon } from 'lucide-react';

interface SidebarPaneProps {
    title: string;
    icon: LucideIcon;
    children: React.ReactNode;
    defaultOpen?: boolean;
    rightElement?: React.ReactNode;
    className?: string;
}

export function SidebarPane({ title, icon: Icon, children, defaultOpen = true, rightElement, className }: SidebarPaneProps) {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <div className={clsx("border-b border-border transition-all duration-300", className)}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between p-4 hover:bg-surface/50 transition-colors group"
            >
                <div className="flex items-center gap-2">
                    <Icon className="w-4 h-4 text-primary" />
                    <h2 className="text-xs font-bold uppercase tracking-wider text-text-muted group-hover:text-text-main transition-colors">
                        {title}
                    </h2>
                </div>
                <div className="flex items-center gap-2">
                    {rightElement}
                    <motion.div
                        animate={{ rotate: isOpen ? 0 : -90 }}
                        transition={{ duration: 0.2 }}
                    >
                        <ChevronDown className="w-4 h-4 text-text-muted/50 group-hover:text-text-muted transition-colors" />
                    </motion.div>
                </div>
            </button>
            <AnimatePresence initial={false}>
                {isOpen && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: "easeInOut" }}
                        className="overflow-hidden"
                    >
                        <div className="px-4 pb-4">
                            {children}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
