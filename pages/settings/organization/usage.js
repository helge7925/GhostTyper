import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { CircleAlert, CircleCheck, CircleDot } from 'lucide-react';
import LoadingSpinner from '../../../components/LoadingSpinner';
import { useCurrentOrg } from '../../../lib/use-current-org';
import { cn } from '../../../lib/utils';
import { useFormatter, useLocale, useTranslations } from '../../../lib/i18n';

function formatPercent(ratio) {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return '—';
  return `${Math.round(ratio * 100)} %`;
}

function trafficColor(level) {
  if (level === 'red') return 'text-danger';
  if (level === 'yellow') return 'text-warning';
  return 'text-success';
}

function TrafficIcon({ level, className = '' }) {
  if (level === 'red') return <CircleAlert className={className} aria-hidden="true" />;
  if (level === 'yellow') return <CircleDot className={className} aria-hidden="true" />;
  return <CircleCheck className={className} aria-hidden="true" />;
}

function StatTile({ label, value, hint }) {
  return (
    <div className="bg-surface border border-subtle rounded-2xl p-5 shadow-xl">
      <p className="text-[10px] font-bold uppercase tracking-widest text-secondary">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-primary truncate">{value}</p>
      {hint && <p className="mt-1 text-xs text-secondary">{hint}</p>}
    </div>
  );
}

function ProgressBar({ value, level }) {
  const pct = Math.max(0, Math.min(1, Number(value) || 0)) * 100;
  return (
    <div className="w-full h-1.5 rounded-full bg-hover-subtle overflow-hidden">
      <div
        className={cn(
          'h-full rounded-full transition-all',
          level === 'red' ? 'bg-danger' : level === 'yellow' ? 'bg-warning' : 'bg-success',
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export default function OrgUsagePage() {
  const router = useRouter();
  const { status: authStatus } = useSession();
  const { org, isLoading: orgLoading } = useCurrentOrg();
  const { locale } = useLocale();
  const { currency, number } = useFormatter();
  const t = useTranslations('organization.usage');
  const tCommon = useTranslations('common');
  const tErrors = useTranslations('errors');

  const formatEuros = (value) =>
    value === null || value === undefined || Number.isNaN(value) ? '—' : currency.format(value);
  const formatNumber = (value) =>
    value === null || value === undefined || Number.isNaN(value) ? '—' : number.format(value);
  const operationLabel = (op) => {
    const key = `operations.${op}`;
    const translated = t(key);
    // useTranslations falls back to the key itself for unknown ids; if that
    // happened we still want to show the raw operation name, not the path.
    return translated === key ? op : translated;
  };

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.replace('/login?next=/settings/organization/usage');
    }
  }, [authStatus, router]);

  useEffect(() => {
    if (!org) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch('/api/organizations/usage')
      .then(async (res) => {
        const text = await res.text();
        let parsed;
        try { parsed = JSON.parse(text); } catch { parsed = null; }
        if (!res.ok) {
          throw new Error(parsed?.message || `HTTP ${res.status}: ${text.slice(0, 200)}`);
        }
        return parsed || {};
      })
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
      })
      .catch((err) => {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.error('Usage fetch failed:', err);
        setError(err?.message || tErrors('loadFailed'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org]);

  if (authStatus === 'loading' || orgLoading || loading) {
    return <LoadingSpinner />;
  }
  if (!org) {
    return (
      <main className="max-w-3xl mx-auto py-12 text-center text-secondary">
        {tCommon('noWorkspace')}
      </main>
    );
  }

  const tl = data?.trafficLight;

  return (
    <>
      <Head>
        <title>{`${t('title')} – GhostTyper`}</title>
      </Head>
      <main className="max-w-5xl mx-auto pb-20 animate-fade-in space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-secondary">
              {t('title')}
            </p>
            <h1 className="text-2xl font-bold text-primary mt-1">{org.name}</h1>
            <p className="text-sm text-secondary mt-1">
              {t('month')}: <strong>{data?.month || '—'}</strong>
            </p>
          </div>
          <Link
            href="/settings/organization"
            className="text-xs text-secondary hover:text-primary transition-colors"
          >
            ← {tCommon('back')}
          </Link>
        </div>

        {error && (
          <div className="bg-danger/10 border border-danger/40 text-danger px-4 py-3 rounded-2xl text-sm">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatTile
            label={t('totalCost')}
            value={formatEuros(data?.totalCost ?? 0)}
            hint={
              data?.effectiveLimit != null
                ? t('totalCostLimitHint', { limit: formatEuros(data.effectiveLimit) })
                : t('totalCostNoLimit')
            }
          />
          <StatTile
            label={t('requests')}
            value={formatNumber(data?.totalRequests ?? 0)}
            hint={t('requestsHint', {
              input: formatNumber(data?.totalInputTokens ?? 0),
              output: formatNumber(data?.totalOutputTokens ?? 0),
            })}
          />
          <StatTile
            label={t('status')}
            value={
              <span className={cn('flex items-center gap-2', trafficColor(tl?.level))}>
                <TrafficIcon level={tl?.level} className="w-5 h-5" />
                {tl?.label || '—'}
              </span>
            }
            hint={tl?.message}
          />
        </div>

        {tl?.limit != null && (
          <div className="bg-surface border border-subtle rounded-2xl p-5 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-secondary">{t('budgetUsage')}</span>
              <span className={cn('font-semibold', trafficColor(tl.level))}>
                {formatEuros(tl.currentCost)} / {formatEuros(tl.limit)} ({formatPercent(tl.usageRatio)})
              </span>
            </div>
            <ProgressBar value={tl.usageRatio} level={tl.level} />
            <p className="text-xs text-secondary">{t('budgetSourceHint')}</p>
          </div>
        )}

        <section className="bg-surface border border-subtle rounded-2xl shadow-xl overflow-hidden">
          <header className="px-5 py-4 border-b border-subtle">
            <h2 className="text-sm font-semibold text-primary">{t('byOperation')}</h2>
            <p className="text-xs text-secondary">{t('byOperationHint')}</p>
          </header>
          <div className="divide-y divide-subtle">
            {(data?.byOperation || []).length === 0 ? (
              <p className="px-5 py-6 text-sm text-secondary">{t('noActivity')}</p>
            ) : (
              (data?.byOperation || []).map((row) => (
                <div key={row.operation} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-5 py-3">
                  <div>
                    <p className="text-sm font-medium text-primary">{operationLabel(row.operation)}</p>
                    <p className="text-[11px] text-secondary">
                      {formatNumber(row.inputTokens)} → {formatNumber(row.outputTokens)} Tokens
                    </p>
                  </div>
                  <p className="text-xs text-secondary">{formatNumber(row.requests)} {t('requestsSuffix')}</p>
                  <p className="text-sm font-mono text-primary">{formatEuros(row.cost)}</p>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="bg-surface border border-subtle rounded-2xl shadow-xl overflow-hidden">
          <header className="px-5 py-4 border-b border-subtle">
            <h2 className="text-sm font-semibold text-primary">{t('byMember')}</h2>
            <p className="text-xs text-secondary">{t('byMemberHint')}</p>
          </header>
          <div className="divide-y divide-subtle">
            {(data?.byMember || []).length === 0 ? (
              <p className="px-5 py-6 text-sm text-secondary">{t('noMembers')}</p>
            ) : (
              (data?.byMember || []).map((row) => (
                <div key={row.userId} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-primary truncate">
                      {row.name || row.email}
                    </p>
                    <p className="text-[11px] text-secondary truncate">
                      {row.email} · {row.role}
                    </p>
                  </div>
                  <p className="text-xs text-secondary">{formatNumber(row.requests)} {t('requestsSuffix')}</p>
                  <p className="text-sm font-mono text-primary">{formatEuros(row.cost)}</p>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
    </>
  );
}
