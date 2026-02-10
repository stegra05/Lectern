import { motion } from 'framer-motion';
import { Skeleton } from './Skeleton';

interface SkeletonCardProps {
    index: number;
}

/**
 * A placeholder card that mimics the layout of a real flashcard preview.
 * Used during generation before real cards stream in.
 */
export function SkeletonCard({ index }: SkeletonCardProps) {
    return (
        <motion.div
            layout
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: -10, transition: { duration: 0.2 } }}
            transition={{
                delay: index * 0.06,
                duration: 0.3,
            }}
            className="bg-surface rounded-xl shadow-sm border border-border border-l-4 border-l-border/50 overflow-hidden"
        >
            {/* Header */}
            <div className="flex items-center gap-2 px-5 py-3 border-b border-border/50">
                <Skeleton className="h-4 w-14" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-3 w-24" />
            </div>
            {/* Body — two "fields" */}
            <div className="p-5 space-y-5">
                <div>
                    <Skeleton className="h-2.5 w-10 mb-2" />
                    <Skeleton className="h-4 w-full mb-1.5" />
                    <Skeleton className="h-4 w-3/4" />
                </div>
                <div>
                    <Skeleton className="h-2.5 w-12 mb-2" />
                    <Skeleton className="h-4 w-full mb-1.5" />
                    <Skeleton className="h-4 w-5/6" />
                </div>
            </div>
        </motion.div>
    );
}
