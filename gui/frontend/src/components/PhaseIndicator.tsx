import { motion } from 'framer-motion';
import { BrainCircuit, Sparkles, FileSearch, Loader2, UploadCloud } from 'lucide-react';
import { clsx } from 'clsx';

export type Phase = 'concept' | 'generating' | 'reflecting' | 'exporting' | 'complete' | 'idle';

interface PhaseIndicatorProps {
    currentPhase: Phase;
}

const phaseConfig = {
    concept: {
        label: 'Analyzing Slides',
        description: 'Building concept map from your PDF',
        icon: FileSearch,
    },
    generating: {
        label: 'Creating Cards',
        description: 'Generating flashcards with AI',
        icon: Sparkles,
    },
    reflecting: {
        label: 'Refining Quality',
        description: 'Reviewing and improving cards',
        icon: BrainCircuit,
    },
    exporting: {
        label: 'Syncing',
        description: 'Exporting to Anki',
        icon: UploadCloud,
    },
    idle: {
        label: 'Ready',
        description: 'Waiting to start',
        icon: Sparkles,
    },
    complete: {
        label: 'Complete',
        description: 'All cards generated',
        icon: Sparkles,
    },
};

export function PhaseIndicator({ currentPhase }: PhaseIndicatorProps) {
    const config = phaseConfig[currentPhase] || phaseConfig.idle;
    const Icon = config.icon;

    return (
        <div className="w-full">
            <motion.div
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                key={currentPhase}
                className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20"
            >
                <div className="relative">
                    <motion.div
                        className="absolute inset-0 rounded-full bg-primary/30 blur-md"
                        animate={{ opacity: [0.3, 0.6, 0.3], scale: [1, 1.2, 1] }}
                        transition={{ duration: 2, repeat: Infinity }}
                    />
                    <div className="relative w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                        {currentPhase !== 'complete' && currentPhase !== 'idle' ? (
                            <Loader2 className="w-5 h-5 text-primary animate-spin" />
                        ) : (
                            <Icon className="w-5 h-5 text-primary" />
                        )}
                    </div>
                </div>
                <div className="flex flex-col">
                    <span className="text-sm font-bold text-primary">
                        {config.label}
                    </span>
                    <span className="text-xs text-text-muted">
                        {config.description}
                    </span>
                </div>
            </motion.div>
        </div>
    );
}
