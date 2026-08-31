import { cn } from '../../lib/utils';

/**
 * Card primitive (ui-sprezzatura-refresh, phase 1 — design.md).
 *
 * Surface + hairline border, no shadow — elevation is reserved for
 * genuinely floating layers (menus, dialogs), which already have
 * their own treatment via `components/ui/sheet.js` / `dialog.js`.
 * One radius token (`rounded-xl`) shared with Button/Field.
 *
 * Usage: `<Card><CardHeader>...</CardHeader><CardBody>...</CardBody></Card>`.
 * Sub-components are optional — plain children work too.
 */
export function Card({ className, ...props }) {
  return (
    <div
      className={cn('bg-surface border border-subtle rounded-xl', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }) {
  return (
    <div
      className={cn('px-5 pt-5 pb-3 border-b border-subtle', className)}
      {...props}
    />
  );
}

export function CardBody({ className, ...props }) {
  return <div className={cn('p-5', className)} {...props} />;
}

export function CardFooter({ className, ...props }) {
  return (
    <div
      className={cn('px-5 pt-3 pb-5 border-t border-subtle', className)}
      {...props}
    />
  );
}
