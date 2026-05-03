import { cn } from '../../lib/utils';

/**
 * Animated placeholder block. Use to fill a layout slot while data loads.
 * Honors prefers-reduced-motion via the global rule in globals.css.
 */
export function Skeleton({ className, ...props }) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-hover-strong', className)}
      aria-hidden="true"
      {...props}
    />
  );
}
