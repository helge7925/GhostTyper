import Head from 'next/head';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { Landmark, ShieldAlert, Users } from 'lucide-react';
import { toast } from 'sonner';
import LoadingSpinner from '../../../components/LoadingSpinner';
import { useCurrentOrg } from '../../../lib/use-current-org';
import { usePermission } from '../../../lib/use-permission';
import { budgetUsdToMicros, microsToUsd } from '../../../lib/billing-ui';
import { useFormatter, useTranslations } from '../../../lib/i18n';

function BudgetInput({ id, label, hint, value, onChange, disabled }) {
  const t = useTranslations('billing.budgets');
  return (
    <label htmlFor={id} className="block">
      <span className="text-xs font-medium text-primary">{label}</span>
      <span className="block text-[11px] text-secondary">{hint}</span>
      <div className="mt-1.5 flex items-center gap-2">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min="0.01"
          step="0.01"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          placeholder={t('noLimit')}
          className="w-full rounded-lg border border-subtle bg-surface-elevated px-3 py-2 text-sm text-primary outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
        />
        <span className="text-xs text-secondary">USD</span>
      </div>
    </label>
  );
}

export default function WorkspaceBudgetsPage() {
  const router = useRouter();
  const { status } = useSession();
  const { org, role, isLoading: orgLoading } = useCurrentOrg();
  const canManage = usePermission('budget.manage');
  const t = useTranslations('billing.budgets');
  const tCommon = useTranslations('common');
  const { currency } = useFormatter();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [workspaceLimit, setWorkspaceLimit] = useState('');
  const [defaultMemberLimit, setDefaultMemberLimit] = useState('');
  const [workspaceReason, setWorkspaceReason] = useState('');
  const [memberId, setMemberId] = useState('');
  const [memberLimit, setMemberLimit] = useState('');
  const [memberReason, setMemberReason] = useState('');
  const [emergencyReason, setEmergencyReason] = useState('');

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login?next=/settings/organization/budgets');
    if (status === 'authenticated' && !orgLoading && org && !canManage) router.replace('/');
  }, [status, orgLoading, org, canManage, router]);

  const load = useCallback(async () => {
    if (!org || !canManage) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/organizations/budgets');
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(t('loadError'));
      setData(payload);
      setWorkspaceLimit(microsToUsd(payload.workspaceLimitMicros)?.toFixed(2) || '');
      setDefaultMemberLimit(microsToUsd(payload.defaultMemberLimitMicros)?.toFixed(2) || '');
      setMemberId((current) => payload.members?.some((member) => String(member.userId) === String(current))
        ? current
        : String(payload.members?.[0]?.userId || ''));
    } catch (requestError) {
      setError(requestError.message || t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [org, canManage, t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const member = data?.members?.find((item) => String(item.userId) === String(memberId));
    setMemberLimit(microsToUsd(member?.monthlyLimitMicros)?.toFixed(2) || '');
  }, [memberId, data]);

  const patch = async (body) => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/organizations/budgets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.code === 'INVALID_BUDGET_INPUT' ? t('invalidAmount') : t('saveError'));
      }
      setData(payload);
      toast.success(t('saveSuccess'));
      return true;
    } catch (requestError) {
      setError(requestError.message || t('saveError'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveWorkspace = async (event) => {
    event.preventDefault();
    try {
      const saved = await patch({
        workspaceLimitMicros: budgetUsdToMicros(workspaceLimit),
        defaultMemberLimitMicros: budgetUsdToMicros(defaultMemberLimit),
        reason: workspaceReason,
      });
      if (saved) setWorkspaceReason('');
    } catch {
      setError(t('invalidAmount'));
    }
  };

  const saveMember = async (event) => {
    event.preventDefault();
    if (!memberId) return;
    try {
      const saved = await patch({
        member: { userId: Number(memberId), monthlyLimitMicros: budgetUsdToMicros(memberLimit) },
        reason: memberReason,
      });
      if (saved) setMemberReason('');
    } catch {
      setError(t('invalidAmount'));
    }
  };

  const emergencyStop = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/organizations/budgets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: emergencyReason }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || t('emergencyStopError'));
      setEmergencyReason('');
      toast.success(t('emergencyStopSuccess'));
    } catch (requestError) {
      setError(requestError.message || t('emergencyStopError'));
    } finally {
      setBusy(false);
    }
  };

  if (status === 'loading' || orgLoading || (org && !canManage) || (org && loading)) return <LoadingSpinner />;
  if (!org) return <main className="py-12 text-center text-secondary">{tCommon('noWorkspace')}</main>;

  return (
    <>
      <Head><title>{`${t('title')} - ${org.name}`}</title></Head>
      <main className="max-w-5xl mx-auto pb-20 animate-fade-in space-y-6">
        <header className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-secondary">{org.name}</p>
            <h1 className="mt-1 text-2xl font-bold text-primary">{t('title')}</h1>
            <p className="mt-1 text-sm text-secondary">{t('description', { role })}</p>
          </div>
          <Link href="/settings/organization" className="text-xs text-secondary hover:text-primary">← {tCommon('back')}</Link>
        </header>

        {error && <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}

        <form onSubmit={saveWorkspace} className="rounded-2xl border border-subtle bg-surface p-5 sm:p-6 shadow-xl space-y-5">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-primary"><Landmark className="w-4 h-4 text-accent-ink" />{t('workspaceTitle')}</h2>
            <p className="mt-1 text-xs text-secondary">{t('workspaceHint')}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <BudgetInput id="workspace-limit" label={t('workspaceLimit')} hint={t('workspaceLimitHint')} value={workspaceLimit} onChange={setWorkspaceLimit} disabled={busy} />
            <BudgetInput id="default-member-limit" label={t('defaultMemberLimit')} hint={t('defaultMemberLimitHint')} value={defaultMemberLimit} onChange={setDefaultMemberLimit} disabled={busy} />
          </div>
          <label htmlFor="workspace-budget-reason" className="block">
            <span className="text-xs font-medium text-primary">{t('reason')}</span>
            <textarea id="workspace-budget-reason" required maxLength={500} rows={2} value={workspaceReason} onChange={(event) => setWorkspaceReason(event.target.value)} className="mt-1.5 w-full rounded-lg border border-subtle bg-surface-elevated px-3 py-2 text-sm text-primary outline-none focus:ring-2 focus:ring-accent" placeholder={t('reasonPlaceholder')} />
          </label>
          <div className="flex justify-end"><button type="submit" disabled={busy || !workspaceReason.trim()} className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? tCommon('saving') : t('saveWorkspace')}</button></div>
        </form>

        <form onSubmit={saveMember} className="rounded-2xl border border-subtle bg-surface p-5 sm:p-6 shadow-xl space-y-5">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-primary"><Users className="w-4 h-4 text-accent-ink" />{t('memberTitle')}</h2>
            <p className="mt-1 text-xs text-secondary">{t('memberHint')}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <label htmlFor="budget-member" className="block">
              <span className="text-xs font-medium text-primary">{t('member')}</span>
              <select id="budget-member" required value={memberId} onChange={(event) => setMemberId(event.target.value)} className="mt-1.5 w-full rounded-lg border border-subtle bg-surface-elevated px-3 py-2 text-sm text-primary outline-none focus:ring-2 focus:ring-accent">
                {(data?.members || []).map((member) => <option key={member.userId} value={member.userId}>{member.name || member.email} ({member.role})</option>)}
              </select>
            </label>
            <BudgetInput id="member-limit" label={t('individualLimit')} hint={t('individualLimitHint')} value={memberLimit} onChange={setMemberLimit} disabled={busy} />
          </div>
          <label htmlFor="member-budget-reason" className="block">
            <span className="text-xs font-medium text-primary">{t('reason')}</span>
            <textarea id="member-budget-reason" required maxLength={500} rows={2} value={memberReason} onChange={(event) => setMemberReason(event.target.value)} className="mt-1.5 w-full rounded-lg border border-subtle bg-surface-elevated px-3 py-2 text-sm text-primary outline-none focus:ring-2 focus:ring-accent" placeholder={t('reasonPlaceholder')} />
          </label>
          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-xs text-secondary">{t('currentDefault', { amount: data?.defaultMemberLimitMicros == null ? t('noLimit') : currency.format(microsToUsd(data.defaultMemberLimitMicros)) })}</p>
            <button type="submit" disabled={busy || !memberId || !memberReason.trim()} className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? tCommon('saving') : t('saveMember')}</button>
          </div>
        </form>

        <form onSubmit={emergencyStop} className="rounded-2xl border border-danger/30 bg-danger/5 p-5 sm:p-6 shadow-xl space-y-4">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-danger"><ShieldAlert className="w-4 h-4" />{t('emergencyStopTitle')}</h2>
            <p className="mt-1 text-xs text-secondary">{t('emergencyStopHint')}</p>
          </div>
          <label htmlFor="budget-emergency-reason" className="block">
            <span className="text-xs font-medium text-primary">{t('reason')}</span>
            <textarea id="budget-emergency-reason" required maxLength={500} rows={2} value={emergencyReason} onChange={(event) => setEmergencyReason(event.target.value)} className="mt-1.5 w-full rounded-lg border border-danger/30 bg-surface-elevated px-3 py-2 text-sm text-primary outline-none focus:ring-2 focus:ring-danger" placeholder={t('emergencyReasonPlaceholder')} />
          </label>
          <div className="flex justify-end"><button type="submit" disabled={busy || !emergencyReason.trim()} className="rounded-xl bg-danger px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{t('emergencyStopAction')}</button></div>
        </form>
      </main>
    </>
  );
}
