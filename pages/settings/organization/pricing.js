import Head from 'next/head';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { BadgeEuro, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import LoadingSpinner from '../../../components/LoadingSpinner';
import PricingRateFields from '../../../components/PricingRateFields';
import { useCurrentOrg } from '../../../lib/use-current-org';
import { usePermission } from '../../../lib/use-permission';
import { eurosToMicros, microsToEuros, toDateTimeLocal, toIsoDate } from '../../../lib/billing-ui';
import { useFormatter, useLocale, useTranslations } from '../../../lib/i18n';

const EMPTY_RATES = { input: '', cachedInput: '', cacheWrite: '', output: '' };

export default function WorkspacePricingPage() {
  const router = useRouter();
  const { status } = useSession();
  const { org, role, isLoading: orgLoading } = useCurrentOrg();
  const canRead = usePermission('budget.read.org');
  const canOverride = usePermission('pricing.override');
  const t = useTranslations('billing.workspacePricing');
  const tPricing = useTranslations('billing.pricing');
  const tCommon = useTranslations('common');
  const { dateTime } = useFormatter();
  const { locale } = useLocale();
  const rateCurrency = new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 6 });
  const [data, setData] = useState({ prices: [], overrides: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [versionId, setVersionId] = useState('');
  const [rates, setRates] = useState(EMPTY_RATES);
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveUntil, setEffectiveUntil] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    setEffectiveFrom((current) => current || toDateTimeLocal());
    if (status === 'unauthenticated') router.replace('/login?next=/settings/organization/pricing');
    if (status === 'authenticated' && !orgLoading && org && !canRead) router.replace('/');
  }, [status, orgLoading, org, canRead, router]);

  const load = useCallback(async () => {
    if (!org || !canRead) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/organizations/pricing');
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(t('loadError'));
      setData(payload);
      setVersionId((current) => payload.prices?.some((price) => String(price.price_version_id) === String(current))
        ? current
        : String(payload.prices?.[0]?.price_version_id || ''));
    } catch (requestError) {
      setError(requestError.message || t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [org, canRead, t]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const selected = data.prices.find((price) => String(price.price_version_id) === String(versionId));
    setEffectiveUntil(selected?.effective_until ? toDateTimeLocal(new Date(selected.effective_until)) : '');
  }, [data.prices, versionId]);

  const updateRate = (field, value) => setRates((current) => ({ ...current, [field]: value }));
  const displayRate = (value) => value === null || value === undefined ? '—' : rateCurrency.format(microsToEuros(value));

  const submitOverride = async (event) => {
    event.preventDefault();
    if (Object.values(rates).every((value) => value === '')) {
      setError(t('atLeastOneRate'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/organizations/pricing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerPriceVersionId: Number(versionId),
          inputPricePerMillionMicros: eurosToMicros(rates.input, { nullable: true }),
          cachedInputPricePerMillionMicros: eurosToMicros(rates.cachedInput, { nullable: true }),
          cacheWritePricePerMillionMicros: eurosToMicros(rates.cacheWrite, { nullable: true }),
          outputPricePerMillionMicros: eurosToMicros(rates.output, { nullable: true }),
          effectiveFrom: toIsoDate(effectiveFrom),
          effectiveUntil: effectiveUntil ? toIsoDate(effectiveUntil) : null,
          reason,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const validationMessage = ['INVALID_PRICE_OVERRIDE', 'PRICE_OVERRIDE_OVERLAP'].includes(payload.code)
          ? t(payload.code === 'PRICE_OVERRIDE_OVERLAP' ? 'overlapError' : 'invalidForm')
          : t('saveError');
        throw new Error(validationMessage);
      }
      toast.success(t('saveSuccess'));
      setRates(EMPTY_RATES);
      setReason('');
      await load();
    } catch (requestError) {
      setError(requestError.code === 'INVALID_BILLING_INPUT'
        ? t('invalidForm')
        : requestError instanceof TypeError ? t('saveError') : (requestError.message || t('invalidForm')));
    } finally {
      setBusy(false);
    }
  };

  if (status === 'loading' || orgLoading || (org && !canRead) || (org && loading)) return <LoadingSpinner />;
  if (!org) return <main className="py-12 text-center text-secondary">{tCommon('noWorkspace')}</main>;

  return (
    <>
      <Head><title>{`${t('title')} - ${org.name}`}</title></Head>
      <main className="max-w-6xl mx-auto pb-20 animate-fade-in space-y-6">
        <header className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-secondary">{org.name}</p>
            <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-primary"><BadgeEuro className="w-5 h-5 text-accent-ink" />{t('title')}</h1>
            <p className="mt-1 text-sm text-secondary">{t(canOverride ? 'ownerDescription' : 'adminDescription', { role })}</p>
          </div>
          <Link href="/settings/organization" className="text-xs text-secondary hover:text-primary">← {tCommon('back')}</Link>
        </header>
        {error && <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}

        <section className="rounded-2xl border border-subtle bg-surface shadow-xl overflow-hidden" aria-labelledby="effective-price-title">
          <header className="p-5 border-b border-subtle">
            <h2 id="effective-price-title" className="text-sm font-semibold text-primary">{t('effectiveTitle')}</h2>
            <p className="mt-1 text-xs text-secondary">{t('effectiveHint')}</p>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-xs">
              <thead className="bg-hover-subtle text-secondary uppercase tracking-wider"><tr><th className="px-4 py-3">{tPricing('providerModel')}</th><th className="px-4 py-3">{tPricing('operation')}</th><th className="px-4 py-3">{tPricing('units')}</th><th className="px-4 py-3">{tPricing('input')}</th><th className="px-4 py-3">{tPricing('cachedInput')}</th><th className="px-4 py-3">{tPricing('cacheWrite')}</th><th className="px-4 py-3">{tPricing('output')}</th><th className="px-4 py-3">{t('source')}</th></tr></thead>
              <tbody className="divide-y divide-subtle">
                {data.prices.map((price) => <tr key={price.price_version_id}><td className="px-4 py-3 text-primary"><strong>{price.provider}</strong><br /><span className="text-secondary">{price.model}</span></td><td className="px-4 py-3 text-primary">{price.operation}</td><td className="px-4 py-3 text-secondary">{price.input_unit} / {price.output_unit}</td><td className="px-4 py-3 tabular-nums">{displayRate(price.input_price_per_million_micros)}</td><td className="px-4 py-3 tabular-nums">{displayRate(price.cached_input_price_per_million_micros)}</td><td className="px-4 py-3 tabular-nums">{displayRate(price.cache_write_price_per_million_micros)}</td><td className="px-4 py-3 tabular-nums">{displayRate(price.output_price_per_million_micros)}</td><td className="px-4 py-3">{price.price_override_id ? <span className="text-accent-ink">{t('override')}</span> : t('catalog')}</td></tr>)}
              </tbody>
            </table>
            {data.prices.length === 0 && <p className="p-6 text-sm text-secondary">{t('empty')}</p>}
          </div>
        </section>

        {canOverride && (
          <form onSubmit={submitOverride} className="rounded-2xl border border-warning/30 bg-surface p-5 sm:p-6 shadow-xl space-y-5">
            <div><h2 className="flex items-center gap-2 text-sm font-semibold text-primary"><ShieldCheck className="w-4 h-4 text-warning" />{t('overrideTitle')}</h2><p className="mt-1 text-xs text-secondary">{t('overrideWarning')}</p></div>
            <label className="block"><span className="text-xs font-medium text-primary">{t('priceVersion')}</span><select required value={versionId} onChange={(event) => setVersionId(event.target.value)} className="mt-1.5 w-full rounded-lg border border-subtle bg-surface-elevated px-3 py-2 text-sm text-primary outline-none focus:ring-2 focus:ring-accent">{data.prices.map((price) => <option key={price.price_version_id} value={price.price_version_id}>{price.provider} / {price.model} / {price.operation}</option>)}</select></label>
            <PricingRateFields values={rates} onChange={updateRate} disabled={busy} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4"><label className="block"><span className="text-xs font-medium text-primary">{tPricing('effectiveFrom')}</span><input type="datetime-local" required value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} className="mt-1.5 w-full rounded-lg border border-subtle bg-surface-elevated px-3 py-2 text-sm text-primary" /></label><label className="block"><span className="text-xs font-medium text-primary">{tPricing('effectiveUntil')}</span><input type="datetime-local" value={effectiveUntil} onChange={(event) => setEffectiveUntil(event.target.value)} className="mt-1.5 w-full rounded-lg border border-subtle bg-surface-elevated px-3 py-2 text-sm text-primary" /></label></div>
            <label className="block"><span className="text-xs font-medium text-primary">{t('reason')}</span><textarea required maxLength={500} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t('reasonPlaceholder')} className="mt-1.5 w-full rounded-lg border border-subtle bg-surface-elevated px-3 py-2 text-sm text-primary outline-none focus:ring-2 focus:ring-accent" /></label>
            <div className="flex justify-end"><button type="submit" disabled={busy || !reason.trim() || !versionId} className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? tCommon('saving') : t('createOverride')}</button></div>
          </form>
        )}

        {data.overrides.length > 0 && <section className="rounded-2xl border border-subtle bg-surface p-5"><h2 className="text-sm font-semibold text-primary">{t('historyTitle')}</h2><ul className="mt-3 divide-y divide-subtle">{data.overrides.map((item) => <li key={item.id} className="py-3 text-xs"><p className="font-medium text-primary">{item.provider} / {item.model} / {item.operation}</p><p className="mt-1 text-secondary">{dateTime.format(new Date(item.effective_from))} · {item.reason}</p></li>)}</ul></section>}
      </main>
    </>
  );
}
