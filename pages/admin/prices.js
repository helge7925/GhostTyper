import Head from 'next/head';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { BadgeEuro, Plus } from 'lucide-react';
import { toast } from 'sonner';
import LoadingSpinner from '../../components/LoadingSpinner';
import PricingRateFields from '../../components/PricingRateFields';
import { eurosToMicros, microsToEuros, toDateTimeLocal, toIsoDate } from '../../lib/billing-ui';
import { useFormatter, useLocale, useTranslations } from '../../lib/i18n';

const UNITS = ['token', 'audio_second', 'character', 'page', 'request'];
const EMPTY_RATES = { input: '', cachedInput: '', cacheWrite: '', output: '' };

export default function AdminPricesPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const t = useTranslations('admin.pricing');
  const tPricing = useTranslations('billing.pricing');
  const tCommon = useTranslations('common');
  const { dateTime } = useFormatter();
  const { locale } = useLocale();
  const rateCurrency = new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 6 });
  const [prices, setPrices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [operation, setOperation] = useState('');
  const [inputUnit, setInputUnit] = useState('token');
  const [outputUnit, setOutputUnit] = useState('token');
  const [rates, setRates] = useState(EMPTY_RATES);
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveUntil, setEffectiveUntil] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    setEffectiveFrom((current) => current || toDateTimeLocal());
    if (status === 'unauthenticated') router.replace('/login?next=/admin/prices');
    if (status === 'authenticated' && session?.user?.role !== 'admin') router.replace('/');
  }, [status, session, router]);

  const load = useCallback(async () => {
    if (status !== 'authenticated' || session?.user?.role !== 'admin') return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/prices');
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(t('loadError'));
      setPrices(payload.prices || []);
    } catch (requestError) {
      setError(requestError.message || t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [status, session, t]);

  useEffect(() => { load(); }, [load]);
  const updateRate = (field, value) => setRates((current) => ({ ...current, [field]: value }));
  const displayRate = (value) => value === null || value === undefined ? '—' : rateCurrency.format(microsToEuros(value));

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/admin/prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider, model, operation, inputUnit, outputUnit,
          inputPricePerMillionMicros: eurosToMicros(rates.input),
          cachedInputPricePerMillionMicros: eurosToMicros(rates.cachedInput, { nullable: true }),
          cacheWritePricePerMillionMicros: eurosToMicros(rates.cacheWrite, { nullable: true }),
          outputPricePerMillionMicros: eurosToMicros(rates.output),
          effectiveFrom: toIsoDate(effectiveFrom),
          effectiveUntil: effectiveUntil ? toIsoDate(effectiveUntil) : null,
          reason,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const validationMessage = payload.code === 'PRICE_VERSION_OVERLAP'
          ? t('overlapError')
          : payload.code === 'INVALID_PRICE' ? t('invalidForm') : t('saveError');
        throw new Error(validationMessage);
      }
      toast.success(t('saveSuccess'));
      setProvider(''); setModel(''); setOperation(''); setRates(EMPTY_RATES); setReason(''); setShowForm(false);
      await load();
    } catch (requestError) {
      setError(requestError.code === 'INVALID_BILLING_INPUT'
        ? t('invalidForm')
        : requestError instanceof TypeError ? t('saveError') : (requestError.message || t('invalidForm')));
    } finally {
      setBusy(false);
    }
  };

  if (status !== 'authenticated' || session?.user?.role !== 'admin' || loading) return <LoadingSpinner />;

  return (
    <>
      <Head><title>{`${t('title')} - Admin`}</title></Head>
      <main className="max-w-6xl mx-auto pb-20 animate-fade-in space-y-6">
        <header className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div><p className="text-[10px] font-bold uppercase tracking-widest text-secondary">{t('eyebrow')}</p><h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-primary"><BadgeEuro className="w-5 h-5 text-accent-ink" />{t('title')}</h1><p className="mt-1 text-sm text-secondary">{t('description')}</p></div>
          <div className="flex flex-wrap items-center gap-3"><Link href="/admin/users" className="text-xs text-secondary hover:text-primary">{t('usersLink')}</Link><button type="button" onClick={() => setShowForm((current) => !current)} className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white"><Plus className="w-4 h-4" />{t('newVersion')}</button></div>
        </header>
        {error && <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}

        {showForm && <form onSubmit={submit} className="rounded-2xl border border-accent/30 bg-surface p-5 sm:p-6 shadow-xl space-y-5">
          <div><h2 className="text-sm font-semibold text-primary">{t('formTitle')}</h2><p className="mt-1 text-xs text-secondary">{t('immutableHint')}</p></div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">{[['provider', provider, setProvider], ['model', model, setModel], ['operation', operation, setOperation]].map(([name, value, setter]) => <label key={name} className="block"><span className="text-xs font-medium text-primary">{tPricing(name)}</span><input required maxLength={120} pattern="[A-Za-z0-9._:-]+" value={value} onChange={(event) => setter(event.target.value)} className="mt-1.5 w-full rounded-lg border border-subtle bg-surface-elevated px-3 py-2 text-sm text-primary outline-none focus:ring-2 focus:ring-accent" /></label>)}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4"><label className="block"><span className="text-xs font-medium text-primary">{tPricing('inputUnit')}</span><select value={inputUnit} onChange={(event) => setInputUnit(event.target.value)} className="mt-1.5 w-full rounded-lg border border-subtle bg-surface-elevated px-3 py-2 text-sm text-primary">{UNITS.map((unit) => <option key={unit}>{unit}</option>)}</select></label><label className="block"><span className="text-xs font-medium text-primary">{tPricing('outputUnit')}</span><select value={outputUnit} onChange={(event) => setOutputUnit(event.target.value)} className="mt-1.5 w-full rounded-lg border border-subtle bg-surface-elevated px-3 py-2 text-sm text-primary">{UNITS.map((unit) => <option key={unit}>{unit}</option>)}</select></label></div>
          <PricingRateFields values={rates} onChange={updateRate} requiredStandardRates disabled={busy} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4"><label className="block"><span className="text-xs font-medium text-primary">{tPricing('effectiveFrom')}</span><input required type="datetime-local" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} className="mt-1.5 w-full rounded-lg border border-subtle bg-surface-elevated px-3 py-2 text-sm text-primary" /></label><label className="block"><span className="text-xs font-medium text-primary">{tPricing('effectiveUntil')}</span><input type="datetime-local" value={effectiveUntil} onChange={(event) => setEffectiveUntil(event.target.value)} className="mt-1.5 w-full rounded-lg border border-subtle bg-surface-elevated px-3 py-2 text-sm text-primary" /></label></div>
          <label className="block"><span className="text-xs font-medium text-primary">{t('reason')}</span><textarea required maxLength={500} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t('reasonPlaceholder')} className="mt-1.5 w-full rounded-lg border border-subtle bg-surface-elevated px-3 py-2 text-sm text-primary outline-none focus:ring-2 focus:ring-accent" /></label>
          <div className="flex justify-end gap-3"><button type="button" onClick={() => setShowForm(false)} className="rounded-xl border border-subtle px-4 py-2 text-sm text-primary">{tCommon('cancel')}</button><button type="submit" disabled={busy || !reason.trim()} className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? tCommon('saving') : t('create')}</button></div>
        </form>}

        <section className="rounded-2xl border border-subtle bg-surface shadow-xl overflow-hidden"><header className="p-5 border-b border-subtle"><h2 className="text-sm font-semibold text-primary">{t('catalogTitle')}</h2><p className="mt-1 text-xs text-secondary">{t('catalogHint')}</p></header><div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-xs"><thead className="bg-hover-subtle text-secondary uppercase tracking-wider"><tr><th className="px-4 py-3">{tPricing('providerModel')}</th><th className="px-4 py-3">{tPricing('operation')}</th><th className="px-4 py-3">{tPricing('units')}</th><th className="px-4 py-3">{tPricing('input')}</th><th className="px-4 py-3">{tPricing('cachedInput')}</th><th className="px-4 py-3">{tPricing('cacheWrite')}</th><th className="px-4 py-3">{tPricing('output')}</th><th className="px-4 py-3">{tPricing('effectiveFrom')}</th><th className="px-4 py-3">{tPricing('effectiveUntil')}</th></tr></thead><tbody className="divide-y divide-subtle">{prices.map((price) => <tr key={price.id}><td className="px-4 py-3 text-primary"><strong>{price.provider}</strong><br /><span className="text-secondary">{price.model}</span></td><td className="px-4 py-3">{price.operation}</td><td className="px-4 py-3 text-secondary">{price.input_unit} / {price.output_unit}</td><td className="px-4 py-3 tabular-nums">{displayRate(price.input_price_per_million_micros)}</td><td className="px-4 py-3 tabular-nums">{displayRate(price.cached_input_price_per_million_micros)}</td><td className="px-4 py-3 tabular-nums">{displayRate(price.cache_write_price_per_million_micros)}</td><td className="px-4 py-3 tabular-nums">{displayRate(price.output_price_per_million_micros)}</td><td className="px-4 py-3">{dateTime.format(new Date(price.effective_from))}</td><td className="px-4 py-3">{price.effective_until ? dateTime.format(new Date(price.effective_until)) : '—'}</td></tr>)}</tbody></table>{prices.length === 0 && <p className="p-6 text-sm text-secondary">{t('empty')}</p>}</div></section>
      </main>
    </>
  );
}
