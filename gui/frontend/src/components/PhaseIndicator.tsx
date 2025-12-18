import { motion } from 'framer-motion';
import { BrainCircuit, Sparkles, CheckCircle2, FileSearch, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';

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
        <div className="w-full py-2">
            <div className="relative flex flex-col gap-8">
                {/* Vertical Line Background */}
                <div className="absolute top-4 left-5 w-0.5 h-[calc(100%-32px)] bg-border -z-10" />

                {/* Progress Line (Vertical) */}
                <motion.div
                    className="absolute top-4 left-5 w-0.5 bg-primary -z-10 origin-top"
                    initial={{ height: '0%' }}
                    animate={{
                        height: isComplete ? 'calc(100% - 32px)' : currentIndex >= 0 ? `${(currentIndex / (phases.length - 1)) * 100}%` : '0%'
                    }}
                    transition={{ duration: 0.5, ease: "easeInOut" }}
                />

                {phases.map((phase, index) => {
                    const isActive = phase.id === currentPhase;
                    const isPast = isComplete || (currentIndex > -1 && index < currentIndex);

                    return (
                        <div key={phase.id} className="flex items-center gap-4 group relative">
                            <div className="relative">
                                {isActive && (
                                    <motion.div
                                        layoutId="active-glow"
                                        className="absolute inset-0 rounded-full bg-primary/30 blur-md"
                                        initial={{ opacity: 0, scale: 0.8 }}
                                        animate={{ opacity: [0.3, 0.6, 0.3], scale: [1, 1.2, 1] }}
                                        transition={{ duration: 2, repeat: Infinity }}
                                    />
                                )}
                                <motion.div
                                    initial={false}
                                    animate={{
                                        scale: isActive ? 1.1 : 1,
                                        backgroundColor: isActive || isPast ? 'rgb(var(--primary))' : 'rgb(var(--surface))',
                                        borderColor: isActive || isPast ? 'rgb(var(--primary))' : 'rgb(var(--border))',
                                        color: isActive || isPast ? 'rgb(var(--background))' : 'rgb(var(--text-muted))'
                                    }}
                                    className={clsx(
                                        "w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors duration-300 z-10 relative",
                                        isActive && "shadow-lg shadow-primary/20"
                                    )}
                                >
                                    {isActive ? (
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                    ) : isPast ? (
                                        <CheckCircle2 className="w-5 h-5" />
                                    ) : (
                                        <phase.icon className="w-5 h-5" />
                                    )}
                                </motion.div>
                            </div>

                            <div className="flex flex-col">
                                <span className={clsx(
                                    "text-sm font-bold transition-colors duration-300",
                                    isActive ? "text-primary" : isPast ? "text-text-main" : "text-text-muted"
                                )}>
                                    {phase.label}
                                </span>

                                <span className="text-xs text-text-muted leading-tight">
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
