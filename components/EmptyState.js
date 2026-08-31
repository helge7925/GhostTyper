import Link from 'next/link';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

/**
 * Reusable empty / zero-data state.
 *
 * Presentational only: the caller decides whether to pass an `action`
 * (gate it with `usePermission` at the call site) so guidance never
 * suggests something the user isn't allowed to do.
 *
 *   <EmptyState
 *     Icon={FileText}
 *     title={t('transcriptions.title')}
 *     description={t('transcriptions.description')}
 *     action={canWrite ? { href: '/upload', label: t('transcriptions.cta') } : null}
 *   />
 */
export default function EmptyState({ Icon, title, description, action, secondary, className }) {
  return (
    <div className={cn('bg-surface border border-subtle rounded-xl p-8 sm:p-12 text-center', className)}>
      {Icon && (
        <div className="w-16 h-16 bg-hover rounded-full flex items-center justify-center mx-auto mb-4">
          <Icon className="w-8 h-8 text-secondary" aria-hidden="true" />
        </div>
      )}
      {title && <p className="text-primary font-medium mb-1">{title}</p>}
      {description && <p className="text-sm text-secondary max-w-md mx-auto">{description}</p>}
      {action && (
        <Button asChild variant="primary" className="mt-6">
          <Link href={action.href}>{action.label}</Link>
        </Button>
      )}
      {secondary && (
        <Link href={secondary.href} className="mt-3 block text-sm text-secondary hover:text-primary">
          {secondary.label}
        </Link>
      )}
    </div>
  );
}
