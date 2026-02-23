import { Skeleton } from './Skeleton';

interface CardSkeletonProps {
    className?: string;
}

export function CardSkeleton({ className }: CardSkeletonProps) {
    return (
        <div className={`bg-surface rounded-xl border border-border shadow-sm overflow-hidden ${className}`}>
            {/* Card header */}
            <div className="px-5 py-3 border-b border-border/50">
                <div className="flex items-center gap-2">
                    <Skeleton variant="text" className="h-4 w-3/4" />
                    <Skeleton variant="text" className="h-3 w-1/2" />
                </div>
            </div>

            {/* Card body */}
            <div className="p-5 space-y-5">
                <Skeleton variant="text" className="h-20 w-full" />
            </div>
        </div>
    );
}