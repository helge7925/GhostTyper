import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import LoadingSpinner from '../../../components/LoadingSpinner';
import { Button } from '../../../components/ui/button';
import { useCurrentOrg } from '../../../lib/use-current-org';
import { usePermission } from '../../../lib/use-permission';
import { useTranslations } from '../../../lib/i18n';

function NumberField({ id, label, hint, value, onChange, suffix = null, min = 0, step = 1, disabled = false }) {
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
            if (raw === '') {
              onChange(null);
              return;
            }
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

export default function OrgPreferencesPage() {
  const router = useRouter();
  const { status: authStatus } = useSession();
  const { org, role, isLoading: orgLoading } = useCurrentOrg();
  const canEdit = usePermission('org.settings');
  const t = useTranslations('organization');
  const tPref = useTranslations('organization.preferences');
  const tCommon = useTranslations('common');
  const tErrors = useTranslations('errors');

  const LANGUAGES = [
    { value: '', label: tPref('noPreference') },
    { value: 'de', label: 'Deutsch' },
    { value: 'en', label: 'English' },
    { value: 'fr', label: 'Français' },
    { value: 'es', label: 'Español' },
  ];

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [defaultLanguage, setDefaultLanguage] = useState('');
  const [retentionDays, setRetentionDays] = useState(null);
  const [costLimitEuros, setCostLimitEuros] = useState(null);
  const [memberMonthlyBudgetEuros, setMemberMonthlyBudgetEuros] = useState(null);
  const [auditRetentionDays, setAuditRetentionDays] = useState(null);
  const [contextBias, setContextBias] = useState('');

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.replace('/login?next=/settings/organization/preferences');
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
        setDefaultLanguage(s.default_language || '');
        setRetentionDays(s.retention_days ?? null);
        setCostLimitEuros(s.cost_limit_cents != null ? s.cost_limit_cents / 100 : null);
        setMemberMonthlyBudgetEuros(
          s.member_monthly_budget_limit_cents != null
            ? s.member_monthly_budget_limit_cents / 100
            : null,
        );
        setAuditRetentionDays(s.audit_retention_days ?? null);
        setContextBias(s.context_bias || '');
      })
      .catch(() => null)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [org]);

  const handleSave = async (event) => {
    event.preventDefault();
    if (!canEdit) return;
    setSaving(true);
    try {
      const response = await fetch('/api/organizations/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          defaultLanguage: defaultLanguage || null,
          retentionDays,
          costLimitCents: costLimitEuros != null ? Math.round(costLimitEuros * 100) : null,
          memberMonthlyBudgetLimitCents:
            memberMonthlyBudgetEuros != null ? Math.round(memberMonthlyBudgetEuros * 100) : null,
          auditRetentionDays,
          contextBias,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        toast.error(payload?.message || tErrors('saveFailed'));
        return;
      }
      toast.success(tPref('saveSuccess'));
    } catch (error) {
      toast.error(error?.message || tErrors('connection'));
    } finally {
      setSaving(false);
    }
  };

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

  return (
    <>
      <Head>
        <title>{`${tPref('title')} – GhostTyper`}</title>
      </Head>
      <main className="max-w-3xl mx-auto pb-20 animate-fade-in space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-secondary">
              {`${t('label')} · ${tPref('title')}`}
            </p>
            <h1 className="text-2xl font-bold text-primary mt-1">{org.name}</h1>
            <p className="text-sm text-secondary mt-1">{t('yourRole')}: {role}</p>
          </div>
          <Link
            href="/settings/organization"
            className="text-xs text-secondary hover:text-primary transition-colors"
          >
            ← {tCommon('back')}
          </Link>
        </div>

        {!canEdit && (
          <div className="bg-surface border border-subtle rounded-2xl px-5 py-4 text-sm text-secondary">
            {tPref('readonlyHint')}
          </div>
        )}

        <form
          onSubmit={handleSave}
          className="bg-surface border border-subtle rounded-2xl shadow-xl p-6 space-y-5"
        >
          <fieldset disabled={!canEdit || saving} className="space-y-5">
            <label className="block">
              <span className="block text-xs font-medium text-primary">{tPref('defaultLanguage')}</span>
              <span className="block text-[11px] text-secondary mt-0.5">
                {tPref('defaultLanguageHint')}
              </span>
              <select
                value={defaultLanguage}
                onChange={(event) => setDefaultLanguage(event.target.value)}
                className="mt-1.5 w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-sm text-primary outline-none focus:border-accent disabled:opacity-50"
              >
                {LANGUAGES.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <NumberField
              id="retention-days"
              label={tPref('retentionDays')}
              hint={tPref('retentionDaysHint')}
              value={retentionDays}
              onChange={setRetentionDays}
              suffix={tPref('days')}
              min={0}
              step={1}
              disabled={!canEdit}
            />

            <NumberField
              id="cost-limit"
              label={tPref('costLimit')}
              hint={tPref('costLimitHint')}
              value={costLimitEuros}
              onChange={setCostLimitEuros}
              suffix="€"
              min={0}
              step={0.01}
              disabled={!canEdit}
            />

            <NumberField
              id="member-budget"
              label={tPref('memberBudget')}
              hint={tPref('memberBudgetHint')}
              value={memberMonthlyBudgetEuros}
              onChange={setMemberMonthlyBudgetEuros}
              suffix="€"
              min={0}
              step={0.01}
              disabled={!canEdit}
            />

            <NumberField
              id="audit-retention"
              label={tPref('auditRetention')}
              hint={tPref('auditRetentionHint')}
              value={auditRetentionDays}
              onChange={setAuditRetentionDays}
              suffix={tPref('days')}
              min={0}
              step={1}
              disabled={!canEdit}
            />

            <label htmlFor="org-context-bias" className="block">
              <span className="block text-xs font-medium text-primary">{tPref('contextBias')}</span>
              <span className="block text-[11px] text-secondary mt-0.5">
                {tPref('contextBiasHint')}
              </span>
              <textarea
                id="org-context-bias"
                value={contextBias}
                onChange={(event) => setContextBias(event.target.value)}
                placeholder={tPref('contextBiasPlaceholder')}
                rows={5}
                className="mt-1.5 w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-sm text-primary outline-none focus:border-accent disabled:opacity-50 resize-none"
              />
            </label>
          </fieldset>

          {canEdit && (
            <div className="flex justify-end pt-2">
              <Button type="submit" disabled={saving}>
                {saving ? tCommon('saving') : tCommon('save')}
              </Button>
            </div>
          )}
        </form>
      </main>
    </>
  );
}
