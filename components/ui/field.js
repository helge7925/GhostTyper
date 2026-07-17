import { forwardRef } from 'react';
import { cn } from '../../lib/utils';

/**
 * Field primitive (ui-sprezzatura-refresh, phase 1 — design.md).
 *
 * Label 12px medium, input 14px, help text below (never inside a
 * placeholder), error state uses text + border color only — no red
 * fills. One radius token shared with Button/Card.
 *
 * Usage:
 *   <Field label="E-Mail" htmlFor="email" help="Wird nie veröffentlicht">
 *     <FieldInput id="email" type="email" value={email} onChange={...} />
 *   </Field>
 *
 * Plain composition, no implicit id generation or context — pass a
 * matching `id`/`htmlFor` pair yourself, same as the rest of the app.
 */
export function Field({ label, htmlFor, help, error, required = false, children, className }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <label htmlFor={htmlFor} className="block text-xs font-medium text-secondary">
          {label}
          {required && <span className="text-danger ml-0.5">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : help ? (
        <p className="text-xs text-secondary">{help}</p>
      ) : null}
    </div>
  );
}

export const FieldInput = forwardRef(function FieldInput({ className, error, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        'w-full bg-surface-elevated border rounded-lg px-3 py-2.5 text-sm text-primary placeholder:text-muted outline-none transition-colors',
        error
          ? 'border-danger focus:border-danger focus:ring-2 focus:ring-danger/30'
          : 'border-subtle focus:border-accent focus:ring-2 focus:ring-accent/30',
        className,
      )}
      {...props}
    />
  );
});
