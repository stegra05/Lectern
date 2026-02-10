import { motion } from 'framer-motion';
import { BrainCircuit, Sparkles, Check, FileSearch } from 'lucide-react';
import { clsx } from 'clsx';
import { PhaseAnimation } from './PhaseAnimation';

export type Phase = 'concept' | 'generating' | 'reflecting' | 'complete' | 'idle';

interface PhaseIndicatorProps {
    currentPhase: Phase;
}

export function PhaseIndicator({ currentPhase }: PhaseIndicatorProps) {
    const phases = [
        {
            id: 'concept',
            label: 'Concept Map',
            description: 'Analyzing structure',
            icon: FileSearch,
        },
        {
            id: 'generating',
            label: 'Generating',
            description: 'Creating cards',
            icon: Sparkles,
        },
        {
            id: 'reflecting',
            label: 'Reflecting',
            description: 'Refining quality',
            icon: BrainCircuit,
        },
    ];

    const currentIndex = phases.findIndex(p => p.id === currentPhase);
    const isComplete = currentPhase === 'complete';

    return (
        <div className="w-full">
            <div className="relative flex flex-col gap-0">
                {phases.map((phase, index) => {
                    const isActive = phase.id === currentPhase;
                    const isPast = isComplete || (currentIndex > -1 && index < currentIndex);
                    const isLast = index === phases.length - 1;

                    return (
                        <div key={phase.id} className="relative pl-10 pb-6 last:pb-0">
                            {/* Connector line */}
                            {!isLast && (
                                <div className="absolute left-[15px] top-[2rem] bottom-0 w-0.5">
                                    <div className="absolute inset-0 bg-border" />
                                    {isPast && (
                                        <motion.div
                                            className="absolute inset-0 bg-primary"
                                            initial={{ scaleY: 0 }}
                                            animate={{ scaleY: 1 }}
                                            transition={{ duration: 0.4, ease: "easeOut" }}
                                            style={{ transformOrigin: 'top' }}
                                        />
                                    )}
                                </div>
                            )}

                            {/* Circle */}
                            <div className="absolute left-0 top-0">
                                {isActive && (
                                    <motion.div
                                        className="absolute inset-0 rounded-full bg-primary/30 blur-md"
                                        animate={{ opacity: [0.3, 0.6, 0.3], scale: [1, 1.3, 1] }}
                                        transition={{ duration: 2, repeat: Infinity }}
                                    />
                                )}
                                <motion.div
                                    initial={false}
                                    animate={{
                                        scale: isActive ? 1.05 : 1,
                                    }}
                                    className={clsx(
                                        "w-8 h-8 rounded-full flex items-center justify-center border-2 z-10 relative transition-colors duration-300",
                                        isActive && "bg-primary border-primary shadow-[0_0_15px_rgba(163,230,53,0.4)]",
                                        isPast && "bg-primary/20 border-primary",
                                        !isActive && !isPast && "bg-surface border-border"
                                    )}
                                >
                                    {isActive ? (
                                        <PhaseAnimation phase={phase.id as Phase} className="text-background" />
                                    ) : isPast ? (
                                        <Check className="w-4 h-4 text-primary" strokeWidth={3} />
                                    ) : (
                                        <phase.icon className="w-4 h-4 text-text-muted" />
                                    )}
                                </motion.div>
                            </div>

                            {/* Label */}
                            <div className="flex flex-col pt-1">
                                <span className={clsx(
                                    "text-sm font-bold transition-colors duration-300",
                                    isActive ? "text-primary" : isPast ? "text-text-main" : "text-text-muted"
                                )}>
                                    {phase.label}
                                </span>
                                <span className={clsx(
                                    "text-xs leading-tight transition-colors duration-300",
                                    isActive ? "text-primary/80" : "text-text-muted"
                                )}>
                                    {phase.description}
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
