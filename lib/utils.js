import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge class names with conflict resolution. Used by every shadcn/ui
 * component — order matters, later classes override earlier ones.
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
