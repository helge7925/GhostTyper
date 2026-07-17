import { forwardRef } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils';

/*
 * Shared Button primitive (ui-sprezzatura-refresh, phase 1).
 *
 * Note on file naming: design.md asks for a `Button.js` primitive
 * alongside `Card.js`/`Field.js`, but this repo's dev filesystem
 * (APFS, case-insensitive) already has `components/ui/button.js` —
 * creating `Button.js` next to it would collide on disk. This file
 * *is* that primitive; it was extended in place rather than
 * duplicated. `primary` is the new quiet-precision variant (solid
 * accent-strong fill, no scale-transform, no glow — see design.md's
 * Button rules); `default` is kept as an alias for the 3 existing
 * call sites so nothing breaks, and gets the same AA-safe fill.
 *
 * `primary`/`default` use `--accent-strong` rather than `--accent`
 * for the solid fill: white text on raw `--accent` (#E84E0F) is
 * 3.80:1, short of the 4.5:1 normal-text floor. `--accent-strong`
 * (#C94509) clears it at 4.84:1. See docs/ui/phase1-tokens.md.
 *
 * `outline` is the "secondary hairline" variant design.md asks for
 * (already hairline-shaped pre-refresh, unchanged here). `secondary`
 * keeps its original filled treatment — 3 existing pages depend on
 * its look and are out of phase-1 scope, so it isn't restyled.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-accent-strong text-white hover:brightness-90',
        default: 'bg-accent-strong text-white hover:brightness-90',
        secondary: 'bg-surface-elevated text-primary border border-subtle hover:bg-hover-strong',
        outline: 'bg-transparent text-primary border border-subtle hover:bg-hover-subtle',
        ghost: 'bg-transparent text-secondary hover:text-primary hover:bg-hover-subtle',
        destructive: 'bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25',
        'destructive-solid': 'bg-danger text-white hover:bg-danger/90',
        link: 'text-accent underline-offset-4 hover:underline bg-transparent',
      },
      size: {
        xs: 'h-7 px-2.5 text-[10px] rounded-md tracking-wide uppercase',
        sm: 'h-8 px-3 text-xs rounded-lg',
        md: 'h-10 px-4 text-sm rounded-xl',
        lg: 'h-11 px-6 text-sm rounded-xl',
        icon: 'h-9 w-9 rounded-lg',
        'icon-sm': 'h-7 w-7 rounded-md',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  },
);

const Button = forwardRef(function Button({ className, variant, size, asChild = false, ...props }, ref) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
});

export { Button, buttonVariants };
