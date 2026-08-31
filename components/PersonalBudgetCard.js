import { useEffect, useState } from 'react';
import { CircleAlert, CircleCheck, CircleDot, Wallet } from 'lucide-react';
import { useFormatter, useTranslations } from '../lib/i18n';
import { microsToUsd } from '../lib/billing-ui';

function StatusIcon({ level }) {
  const className = `w-4 h-4 ${level === 'red' ? 'text-danger' : level === 'yellow' ? 'text-warning' : 'text-success'}`;
  if (level === 'red') return <CircleAlert className={className} aria-hidden="true" />;
  if (level === 'yellow') return <CircleDot className={className} aria-hidden="true" />;
  return <CircleCheck className={className} aria-hidden="true" />;
}

export default function PersonalBudgetCard({ className = '' }) {
  const t = useTranslations('billing.personal');
  const { currency } = useFormatter();
  const [usage, setUsage] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/usage/me')
      .then(async (response) => {
        if (!response.ok) throw new Error(t('loadError'));
        return response.json();
      })
      .then((payload) => {
        if (!cancelled) setUsage(payload);
      })
      .catch(() => {
        if (!cancelled) setError(t('loadError'));
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const cost = microsToUsd(usage?.ownCostMicros);
  const remaining = microsToUsd(usage?.effectiveRemainingMicros);
  const level = usage?.level || 'green';

  return (
    <section className={`bg-surface border border-subtle rounded-2xl p-5 shadow-xl ${className}`} aria-labelledby="personal-budget-title">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-secondary">{t('eyebrow')}</p>
          <h2 id="personal-budget-title" className="mt-1 text-base font-semibold text-primary flex items-center gap-2">
            <Wallet className="w-4 h-4 text-accent-ink" aria-hidden="true" />
            {t('title')}
          </h2>
        </div>
        {usage && (
          <span className="inline-flex items-center gap-1.5 text-xs text-secondary">
            <StatusIcon level={level} />
            {t(`levels.${level}`)}
          </span>
        )}
      </div>

      {error ? (
        <p role="alert" className="mt-4 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
      ) : (
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3" aria-busy={!usage}>
          <div className="rounded-xl border border-subtle bg-hover-subtle p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-secondary">{t('ownCost')}</p>
            <p className="mt-1 text-2xl font-semibold text-primary tabular-nums">
              {usage ? currency.format(cost || 0) : '...'}
            </p>
          </div>
          <div className="rounded-xl border border-subtle bg-hover-subtle p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-secondary">{t('remaining')}</p>
            <p className="mt-1 text-2xl font-semibold text-primary tabular-nums">
              {usage ? (remaining === null ? t('unlimited') : currency.format(remaining)) : '...'}
            </p>
          </div>
        </div>
      )}
      <p className="mt-3 text-xs text-secondary">{t('month', { month: usage?.month || '...' })}</p>
      <p className="mt-1 text-xs text-secondary">{t('privacyHint')}</p>
    </section>
  );
}
