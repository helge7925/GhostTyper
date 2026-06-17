import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import { Plug, Wallet } from 'lucide-react';
import LoadingSpinner from '../../../components/LoadingSpinner';
import { Button } from '../../../components/ui/button';
import CortecsIntegrationPanel from '../../../components/settings/CortecsIntegrationPanel';
import MistralIntegrationPanel from '../../../components/settings/MistralIntegrationPanel';
import VexaIntegrationPanel from '../../../components/settings/VexaIntegrationPanel';
import { useCurrentOrg } from '../../../lib/use-current-org';
import { usePermission } from '../../../lib/use-permission';
import { useTranslations } from '../../../lib/i18n';

function NumberField({ id, label, hint, value, onChange, suffix, min = 0, step = 1, disabled = false }) {
  return (
    <label htmlFor={id} className="block">
      <span className="block text-xs font-medium text-primary">{label}</span>
      {hint && <span className="block text-[11px] text-secondary mt-0.5">{hint}</span>}
      <div className="mt-1.5 flex items-center gap-2">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          step={step}
          disabled={disabled}
          value={value === null || value === undefined ? '' : value}
          onChange={(event) => {
            const raw = event.target.value;
            if (raw === '') return onChange(null);
            const parsed = Number(raw);
            onChange(Number.isFinite(parsed) ? parsed : null);
          }}
          className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-sm text-primary outline-none focus:border-accent disabled:opacity-50"
        />
        {suffix && <span className="text-xs text-secondary shrink-0">{suffix}</span>}
      </div>
    </label>
  );
}

export default function WorkspaceIntegrationsPage() {
  const router = useRouter();
  const { status: authStatus } = useSession();
  const { org, role, isLoading: orgLoading } = useCurrentOrg();
  const canEditIntegrations = usePermission('meeting.admin');
  const canEditSettings = usePermission('org.settings');
  const t = useTranslations('organization.integrations');
  const tCommon = useTranslations('common');
  const tNav = useTranslations('nav');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [costLimitEuros, setCostLimitEuros] = useState(null);
  const [memberMonthlyBudgetEuros, setMemberMonthlyBudgetEuros] = useState(null);

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.replace('/login?next=/settings/organization/integrations');
    }
  }, [authStatus, router]);

  useEffect(() => {
    if (!org) return;
    let cancelled = false;
    setLoading(true);
    fetch('/api/organizations/settings')
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (cancelled || !payload) return;
        const s = payload.settings || {};
        setCostLimitEuros(s.cost_limit_cents != null ? s.cost_limit_cents / 100 : null);
        setMemberMonthlyBudgetEuros(
          s.member_monthly_budget_limit_cents != null
            ? s.member_monthly_budget_limit_cents / 100
            : null,
        );
      })
      .catch(() => null)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [org]);

  const handleSaveLimits = async (event) => {
    event.preventDefault();
    if (!canEditSettings) return;
    setSaving(true);
    try {
      const res = await fetch('/api/organizations/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          costLimitCents: costLimitEuros != null ? Math.round(costLimitEuros * 100) : null,
          memberMonthlyBudgetLimitCents:
            memberMonthlyBudgetEuros != null ? Math.round(memberMonthlyBudgetEuros * 100) : null,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.message || tCommon('error'));
      }
      toast.success(t('limitsSaved'));
    } catch (error) {
      toast.error(error.message || tCommon('error'));
    } finally {
      setSaving(false);
    }
  };

  if (authStatus === 'loading' || orgLoading || loading) return <LoadingSpinner />;
  if (!org) {
    return <main className="max-w-3xl mx-auto py-12 text-center text-secondary">{tCommon('noWorkspace')}</main>;
  }

  return (
    <>
      <Head>
        <title>{`${t('title')} – GhostTyper`}</title>
      </Head>
      <main className="max-w-5xl mx-auto pb-20 animate-fade-in space-y-10">
        <header className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-secondary">{org.name}</p>
            <h1 className="text-2xl font-bold text-primary mt-1 flex items-center gap-2">
              <Plug className="w-5 h-5" /> {t('title')}
            </h1>
            <p className="text-sm text-secondary mt-1 max-w-prose">{t('description')}</p>
          </div>
          <Link
            href="/settings/organization"
            className="text-xs text-secondary hover:text-primary transition-colors whitespace-nowrap"
          >
            ← {tNav('admin')}
          </Link>
        </header>

        <section className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-secondary uppercase tracking-widest">{t('aiProviders')}</h2>
            <p className="text-xs text-secondary mt-1 max-w-prose">{t('aiProvidersHint')}</p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <CortecsIntegrationPanel canEdit={canEditIntegrations} />
            <MistralIntegrationPanel canEdit={canEditIntegrations} />
          </div>
        </section>

        <section className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-secondary uppercase tracking-widest">{t('meetingBots')}</h2>
            <p className="text-xs text-secondary mt-1 max-w-prose">{t('meetingBotsHint')}</p>
          </div>
          <VexaIntegrationPanel canEdit={canEditIntegrations} />
        </section>

        <section className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-secondary uppercase tracking-widest flex items-center gap-2">
              <Wallet className="w-4 h-4" /> {t('costLimits')}
            </h2>
            <p className="text-xs text-secondary mt-1 max-w-prose">{t('costLimitsHint')}</p>
          </div>
          <form
            onSubmit={handleSaveLimits}
            className="bg-surface border border-subtle rounded-2xl p-6 shadow-xl space-y-5"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <NumberField
                id="cost-limit"
                label={t('orgLimitLabel')}
                hint={t('orgLimitHint')}
                value={costLimitEuros}
                onChange={setCostLimitEuros}
                suffix="EUR"
                step="0.01"
                disabled={!canEditSettings}
              />
              <NumberField
                id="member-budget-limit"
                label={t('memberLimitLabel')}
                hint={t('memberLimitHint')}
                value={memberMonthlyBudgetEuros}
                onChange={setMemberMonthlyBudgetEuros}
                suffix="EUR"
                step="0.01"
                disabled={!canEditSettings}
              />
            </div>
            <div className="flex justify-end pt-3 border-t border-subtle">
              <Button type="submit" disabled={!canEditSettings || saving}>
                {saving ? tCommon('saving') : tCommon('save')}
              </Button>
            </div>
            {!canEditSettings && (
              <p className="text-[11px] text-secondary italic">{t('limitsReadOnly')}</p>
            )}
          </form>
        </section>
      </main>
    </>
  );
}
