import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  variant?: 'text' | 'circular' | 'rectangular' | 'rounded';
}

export function Skeleton({ className, variant = 'text', ...props }: SkeletonProps) {
  return (
    <div
      className={twMerge(
        clsx(
          "animate-pulse bg-surface/80",
          {
            'rounded-md': variant === 'text',
            'rounded-full': variant === 'circular',
            'rounded-none': variant === 'rectangular',
            'rounded-xl': variant === 'rounded',
          },
          className
        )
      )}
      {...props}
    />
  );
}
