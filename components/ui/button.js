import { forwardRef } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'gradient-accent text-white shadow-lg shadow-accent/20 hover:gradient-accent-hover active:scale-[0.98]',
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
