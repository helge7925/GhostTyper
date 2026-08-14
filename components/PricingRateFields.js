import { useTranslations } from '../lib/i18n';

const FIELDS = [
  ['input', 'input'],
  ['cachedInput', 'cachedInput'],
  ['cacheWrite', 'cacheWrite'],
  ['output', 'output'],
];

export default function PricingRateFields({ values, onChange, requiredStandardRates = false, disabled = false }) {
  const t = useTranslations('billing.pricing');
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {FIELDS.map(([name, labelKey]) => (
        <label key={name} className="block">
          <span className="text-xs font-medium text-primary">{t(labelKey)}</span>
          <span className="block text-[11px] text-secondary">{t('rateHint')}</span>
          <input
            type="number"
            min="0"
            step="0.000001"
            inputMode="decimal"
            required={requiredStandardRates && (name === 'input' || name === 'output')}
            disabled={disabled}
            value={values[name]}
            onChange={(event) => onChange(name, event.target.value)}
            placeholder={t('notSet')}
            className="mt-1.5 w-full rounded-lg border border-subtle bg-surface-elevated px-3 py-2 text-sm text-primary outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
          />
        </label>
      ))}
    </div>
  );
}
