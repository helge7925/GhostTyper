import { useTranslations } from '../lib/i18n';

export default function LoadingSpinner({ label }) {
  const tCommon = useTranslations('common');
  // Callers may pass their own, more specific wording; the default follows the
  // viewer's locale rather than being German for everyone.
  const announced = label || tCommon('loading');

  return (
    <div className="flex justify-center items-center py-12" role="status" aria-live="polite">
      <div className="w-8 h-8 border-4 border-accent/30 border-t-accent rounded-full animate-spin" aria-hidden="true" />
      <span className="sr-only">{announced}</span>
    </div>
  );
}
