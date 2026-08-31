import Head from 'next/head';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { Download, Filter, ShieldCheck } from 'lucide-react';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import { Skeleton } from '../components/ui/skeleton';
import { Button } from '../components/ui/button';
import { useCurrentOrg } from '../lib/use-current-org';
import { usePermission } from '../lib/use-permission';
import { cn } from '../lib/utils';
import { useFormatter, useTranslations } from '../lib/i18n';
import { eventsToCsv } from '../lib/audit-csv';

const SEVERITY_STYLES = {
  info: 'bg-info/10 text-info border-info/30',
  warn: 'bg-warning/15 text-warning border-warning/30',
  error: 'bg-danger/15 text-danger border-danger/30',
};

export default function AuditPage() {
  const router = useRouter();
  const { status: authStatus } = useSession();
  const { org, isLoading: orgLoading } = useCurrentOrg();
  const canRead = usePermission('audit.read');
  const canExport = usePermission('audit.export');
  const t = useTranslations('auditPage');
  const tNav = useTranslations('nav');
  const tCommon = useTranslations('common');
  const tEmpty = useTranslations('emptyState.audit');
  const { dateTime } = useFormatter();

  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterAction, setFilterAction] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('');
  const [packageExporting, setPackageExporting] = useState(false);
  const [packageError, setPackageError] = useState('');
  const [verification, setVerification] = useState(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.replace('/login?next=/audit');
    }
  }, [authStatus, router]);

  const refresh = useCallback(async () => {
    if (!org || !canRead) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (filterAction) params.set('action', filterAction);
      if (filterSeverity) params.set('severity', filterSeverity);
      const res = await fetch(`/api/audit-log?${params.toString()}`);
      const payload = await res.json();
      setEvents(Array.isArray(payload?.events) ? payload.events : []);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [org, canRead, filterAction, filterSeverity]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const distinctActions = useMemo(() => {
    return Array.from(new Set(events.map((e) => e.action))).sort();
  }, [events]);

  const handleExport = () => {
    const csv = eventsToCsv(events);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `audit-${org?.slug || 'org'}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handlePackageExport = async () => {
    setPackageExporting(true);
    setPackageError('');
    try {
      const response = await fetch('/api/audit-log/export');
      if (!response.ok) throw new Error('AUDIT_EXPORT_FAILED');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `audit-${org?.slug || 'org'}-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setPackageError(t('exportPackageError'));
    } finally {
      setPackageExporting(false);
    }
  };

  const handleVerify = async () => {
    setVerifying(true);
    setVerification(null);
    try {
      const response = await fetch('/api/audit-log?verify=1');
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.code || 'AUDIT_VERIFY_FAILED');
      setVerification(payload.verification || { valid: false });
    } catch {
      setVerification({ valid: false, error: true });
    } finally {
      setVerifying(false);
    }
  };

  if (authStatus === 'loading' || orgLoading) {
    return <LoadingSpinner />;
  }

  if (!canRead) {
    return (
      <main className="max-w-3xl mx-auto py-12 text-center">
        <ShieldCheck className="w-12 h-12 mx-auto text-secondary mb-3" aria-hidden="true" />
        <h1 className="text-lg font-semibold text-primary">{tCommon('error')}</h1>
        <p className="text-sm text-secondary mt-2">
          {tCommon('loginRequired')}
        </p>
        <Link
          href="/settings"
          className="mt-4 inline-block text-xs text-accent-ink hover:underline"
        >
          ← {tNav('settings')}
        </Link>
      </main>
    );
  }

  return (
    <>
      <Head>
        <title>{`${t('title')} – ${org?.name || 'GhostTyper'}`}</title>
      </Head>
      <main className="max-w-6xl mx-auto pb-20 animate-fade-in space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-secondary">{t('title')}</p>
            <h1 className="text-2xl font-bold text-primary mt-1 flex items-center gap-2">
              <ShieldCheck className="w-6 h-6 text-accent-ink" aria-hidden="true" />
              {t('title')}
            </h1>
            <p className="text-sm text-secondary mt-1">{t('subtitle')}</p>
          </div>
          {canExport && (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={handleExport} disabled={events.length === 0}>
                <Download className="w-4 h-4" aria-hidden="true" />
                {t('exportCsv')}
              </Button>
              <Button type="button" variant="secondary" onClick={handleVerify} disabled={verifying}>
                <ShieldCheck className="w-4 h-4" aria-hidden="true" />
                {verifying ? t('verifyingChain') : t('verifyChain')}
              </Button>
              <Button type="button" variant="primary" onClick={handlePackageExport} disabled={packageExporting}>
                <ShieldCheck className="w-4 h-4" aria-hidden="true" />
                {packageExporting ? t('exportingPackage') : t('exportPackage')}
              </Button>
            </div>
          )}
        </div>

        {packageError && <p role="alert" className="text-sm text-danger">{packageError}</p>}
        {verification && (
          <p role="status" className={cn('text-sm rounded-xl border px-4 py-3', verification.valid
            ? 'border-success/30 bg-success/10 text-success'
            : 'border-danger/30 bg-danger/10 text-danger')}
          >
            {verification.valid
              ? t('chainValid', { count: verification.rows || 0 })
              : t('chainInvalid', { id: verification.errors?.[0]?.id || '–' })}
          </p>
        )}

        {/* Filter bar */}
        <div className="bg-surface border border-subtle rounded-2xl p-4 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="filter-action" className="block text-[10px] font-bold uppercase tracking-widest text-secondary mb-1">
              {t('filterAction')}
            </label>
            <select
              id="filter-action"
              value={filterAction}
              onChange={(event) => setFilterAction(event.target.value)}
              className="bg-surface-elevated border border-subtle rounded-lg px-3 py-1.5 text-sm text-primary outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="">{tCommon('search')}</option>
              {distinctActions.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="filter-severity" className="block text-[10px] font-bold uppercase tracking-widest text-secondary mb-1">
              {t('filterSeverity')}
            </label>
            <select
              id="filter-severity"
              value={filterSeverity}
              onChange={(event) => setFilterSeverity(event.target.value)}
              className="bg-surface-elevated border border-subtle rounded-lg px-3 py-1.5 text-sm text-primary outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="">{tCommon('search')}</option>
              <option value="info">info</option>
              <option value="warn">warn</option>
              <option value="error">error</option>
            </select>
          </div>
          {(filterAction || filterSeverity) && (
            <button
              type="button"
              onClick={() => { setFilterAction(''); setFilterSeverity(''); }}
              className="text-xs text-secondary hover:text-primary"
            >
              {t('resetFilters')}
            </button>
          )}
        </div>

        {/* Events list */}
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <EmptyState Icon={Filter} title={tEmpty('title')} description={tEmpty('description')} />
        ) : (
          <div className="bg-surface border border-subtle rounded-2xl overflow-hidden">
            <ul className="divide-y divide-subtle">
              {events.map((event) => (
                <li key={event.id} className="px-5 py-3 flex items-start gap-3">
                  <span
                    className={cn(
                      'shrink-0 mt-0.5 inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] uppercase font-bold tracking-wider',
                      SEVERITY_STYLES[event.severity || 'info'] || SEVERITY_STYLES.info,
                    )}
                  >
                    {event.severity || 'info'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-primary font-mono truncate">{event.action}</p>
                    <p className="text-[11px] text-secondary truncate">
                      {dateTime.format(new Date(event.created_at))}
                      {event.target_type && ` · ${event.target_type}`}
                      {event.target_id && ` #${event.target_id}`}
                      {event.user_id && ` · user ${event.user_id}`}
                    </p>
                    {event.metadata && Object.keys(event.metadata).length > 0 && (
                      <details className="mt-1">
                        <summary className="text-[11px] text-secondary cursor-pointer hover:text-primary">{t('tableMetadata')}</summary>
                        <pre className="mt-1 bg-surface-elevated border border-subtle rounded-md p-2 text-[10px] text-secondary overflow-x-auto">
                          {JSON.stringify(event.metadata, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
    </>
  );
}
