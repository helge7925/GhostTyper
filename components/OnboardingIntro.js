import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Languages, Mic, ScanText, X } from 'lucide-react';
import { useTranslations } from '../lib/i18n';
import { useUIStore } from '../lib/store/ui-store';

// Locale-independent route metadata; titles/bodies resolved via i18n.
const STEPS = [
  { href: '/upload', Icon: Mic, key: 'record' },
  { href: '/ocr', Icon: ScanText, key: 'ocr' },
  { href: '/translate', Icon: Languages, key: 'translate' },
];

/**
 * Dismissible first-run intro shown on the dashboard. Orients new users to
 * the core capture features. Dismissal is persisted in localStorage so it
 * does not reappear. Assume-dismissed on first render avoids a flash for
 * returning users who already closed it.
 */
export default function OnboardingIntro() {
  const t = useTranslations('onboarding');
  const { data: session } = useSession();
  const [mounted, setMounted] = useState(false);
  const dismissedByUser = useUIStore((state) => state.onboardingDismissedByUser);
  const dismissOnboarding = useUIStore((state) => state.dismissOnboarding);
  const userId = session?.user?.id;
  const dismissed = userId ? Boolean(dismissedByUser?.[String(userId)]) : true;

  useEffect(() => {
    setMounted(true);
  }, []);

  function dismiss() {
    dismissOnboarding(userId);
  }

  if (!mounted || dismissed) return null;

  return (
    <section className="relative mt-6 rounded-2xl border border-accent/30 bg-accent/5 p-6">
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('dismiss')}
        className="absolute top-4 right-4 text-secondary hover:text-primary transition-colors"
      >
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
      <p className="text-[10px] uppercase tracking-[0.22em] text-accent-ink">{t('badge')}</p>
      <h2 className="mt-2 text-lg font-semibold text-primary">{t('title')}</h2>
      <p className="mt-1 text-sm text-secondary">{t('subtitle')}</p>
      <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
        {STEPS.map(({ href, Icon, key }) => (
          <Link
            key={href}
            href={href}
            className="rounded-xl border border-subtle bg-surface px-4 py-3 hover:border-accent/30 transition-colors"
          >
            <Icon className="w-5 h-5 text-accent-ink mb-2" aria-hidden="true" />
            <p className="text-sm font-semibold text-primary">{t(`steps.${key}.title`)}</p>
            <p className="mt-0.5 text-xs text-secondary">{t(`steps.${key}.body`)}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
