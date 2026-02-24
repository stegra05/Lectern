import { Skeleton } from './Skeleton';

interface CardSkeletonProps {
    className?: string;
}

export function CardSkeleton({ className }: CardSkeletonProps) {
    return (
        <div className={`bg-surface rounded-xl shadow-sm overflow-hidden border border-border border-l-4 border-l-primary/30 ${className}`}>
            {/* Card header - matches actual card structure */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-border/50">
                <div className="flex items-center gap-2">
                    {/* Model badge skeleton */}
                    <Skeleton variant="rectangular" className="h-5 w-14 rounded" />
                    {/* Slide badge skeleton */}
                    <Skeleton variant="rectangular" className="h-5 w-20 rounded" />
                    {/* Topic text skeleton */}
                    <Skeleton variant="text" className="h-3 w-32" />
                </div>
            </div>

            {/* Card body - matches field structure */}
            <div className="p-5 space-y-5">
                {/* Field 1: label + content */}
                <div>
                    <Skeleton variant="text" className="h-3 w-16 mb-1.5" />
                    <Skeleton variant="text" className="h-4 w-full" />
                    <Skeleton variant="text" className="h-4 w-3/4 mt-1" />
                </div>
                {/* Field 2: label + content */}
                <div>
                    <Skeleton variant="text" className="h-3 w-20 mb-1.5" />
                    <Skeleton variant="text" className="h-4 w-full" />
                    <Skeleton variant="text" className="h-4 w-5/6 mt-1" />
                    <Skeleton variant="text" className="h-4 w-2/3 mt-1" />
                </div>
            </div>
        </div>
    );
}