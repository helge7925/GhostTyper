import { useCallback, useEffect, useState } from 'react';
import { BrainCircuit, ShieldCheck, ShieldAlert, Loader2 } from 'lucide-react';
import { useTranslations } from '../../lib/i18n';
import { useUiFeedback } from '../../lib/use-ui-feedback';

const ENDPOINT = '/api/organizations/integrations/cortecs';
const TEST_ENDPOINT = '/api/organizations/integrations/cortecs/test';

export default function CortecsIntegrationPanel({ canEdit }) {
  const t = useTranslations('settings.integrations.cortecs');
  const tCommon = useTranslations('common');
  const { showToast } = useUiFeedback();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [operatorFallback, setOperatorFallback] = useState(false);
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://api.cortecs.ai/v1');
  const [chatModel, setChatModel] = useState('deepseek-v4-pro');
  const [transcriptionModel, setTranscriptionModel] = useState('whisper-large-v3');
  const [preference, setPreference] = useState('balanced');
  const [healthState, setHealthState] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(ENDPOINT, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const cfg = data.config || {};
      const defaults = data.defaults || {};
      setEnabled(!!data.enabled);
      setOperatorFallback(!!data.operatorFallback);
      setApiKeyConfigured(!!cfg.apiKeyConfigured);
      setApiKeyInput('');
      setBaseUrl(cfg.baseUrl || defaults.baseUrl || 'https://api.cortecs.ai/v1');
      setChatModel(cfg.defaultChatModel || defaults.defaultChatModel || 'deepseek-v4-pro');
      setTranscriptionModel(cfg.defaultTranscriptionModel || defaults.defaultTranscriptionModel || 'whisper-large-v3');
      setPreference(cfg.preference || defaults.preference || 'balanced');
    } catch {
      showToast(t('loadError'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (overrides = {}) => {
    if (!canEdit) return;
    setSaving(true);
    try {
      const autoEnable = !!apiKeyInput && !apiKeyConfigured && !enabled;
      const nextEnabled = typeof overrides.enabled === 'boolean'
        ? overrides.enabled
        : (autoEnable ? true : enabled);
      const body = {
        enabled: nextEnabled,
        baseUrl,
        defaultChatModel: chatModel,
        defaultTranscriptionModel: transcriptionModel,
        preference,
      };
      if (apiKeyInput) body.apiKey = apiKeyInput;
      const res = await fetch(ENDPOINT, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.message || t('saveError'));
      }
      setEnabled(nextEnabled);
      showToast(t('saveSuccess'), 'success');
      await load();
    } catch (error) {
      showToast(error.message || t('saveError'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!canEdit) return;
    setTesting(true);
    setHealthState(null);
    try {
      const res = await fetch(TEST_ENDPOINT, { method: 'POST', credentials: 'same-origin' });
      const payload = await res.json().catch(() => ({}));
      if (res.ok && payload.ok) {
        setHealthState({ ok: true });
        showToast(t('testSuccess'), 'success');
      } else {
        setHealthState({ ok: false });
        showToast(payload.message || t('testError'), 'error');
      }
    } catch (error) {
      setHealthState({ ok: false });
      showToast(error.message || t('testError'), 'error');
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-surface border border-subtle rounded-2xl p-6 shadow-xl">
        <div className="flex items-center gap-2 text-secondary text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> {tCommon('loading')}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-subtle rounded-2xl p-6 shadow-xl space-y-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-secondary uppercase tracking-widest flex items-center gap-2">
            <BrainCircuit className="w-4 h-4" /> {t('title')}
          </h3>
          <p className="text-xs text-secondary mt-1 max-w-prose">{t('description')}</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {healthState?.ok ? (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-success/10 text-success border border-success/30">
              <ShieldCheck className="w-3 h-3" /> {t('connected')}
            </span>
          ) : healthState?.ok === false ? (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-danger/10 text-danger border border-danger/30">
              <ShieldAlert className="w-3 h-3" /> {t('disconnected')}
            </span>
          ) : null}
        </div>
      </header>

      <div className="flex items-center justify-between gap-4 bg-hover-subtle border border-subtle rounded-xl px-4 py-3">
        <div>
          <p className="text-sm text-primary font-medium">{t('enableLabel')}</p>
          <p className="text-xs text-secondary mt-0.5">
            {operatorFallback ? t('enableHintWithFallback') : t('enableHint')}
          </p>
        </div>
        <label className="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={enabled}
            disabled={!canEdit || saving || (!apiKeyConfigured && !apiKeyInput)}
            onChange={(e) => handleSave({ enabled: e.target.checked })}
          />
          <span className="w-10 h-6 rounded-full bg-subtle peer-checked:bg-accent transition-colors relative after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-5 after:h-5 after:bg-white after:rounded-full after:transition-transform peer-checked:after:translate-x-4" />
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="block text-xs font-medium text-secondary">
          {t('chatModelLabel')}
          <input value={chatModel} disabled={!canEdit} onChange={(e) => setChatModel(e.target.value)} className="mt-1.5 w-full bg-surface-elevated border border-subtle rounded-xl px-4 py-2.5 text-sm text-primary outline-none disabled:opacity-60" />
        </label>
        <label className="block text-xs font-medium text-secondary">
          {t('transcriptionModelLabel')}
          <input value={transcriptionModel} disabled={!canEdit} onChange={(e) => setTranscriptionModel(e.target.value)} className="mt-1.5 w-full bg-surface-elevated border border-subtle rounded-xl px-4 py-2.5 text-sm text-primary outline-none disabled:opacity-60" />
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="block text-xs font-medium text-secondary">
          {t('baseUrlLabel')}
          <input value={baseUrl} disabled={!canEdit} onChange={(e) => setBaseUrl(e.target.value)} className="mt-1.5 w-full bg-surface-elevated border border-subtle rounded-xl px-4 py-2.5 text-sm text-primary outline-none disabled:opacity-60" />
        </label>
        <label className="block text-xs font-medium text-secondary">
          {t('preferenceLabel')}
          <select value={preference} disabled={!canEdit} onChange={(e) => setPreference(e.target.value)} className="mt-1.5 w-full bg-surface-elevated border border-subtle rounded-xl px-4 py-2.5 text-sm text-primary outline-none disabled:opacity-60">
            <option value="balanced">{t('preferenceBalanced')}</option>
            <option value="speed">{t('preferenceSpeed')}</option>
            <option value="cost">{t('preferenceCost')}</option>
          </select>
        </label>
      </div>

      <div>
        <label className="block text-xs font-medium text-secondary mb-1.5">
          {t('apiKeyLabel')}
          {apiKeyConfigured && <span className="ml-2 text-[10px] uppercase text-success/80 tracking-wider">{t('configured')}</span>}
        </label>
        <input type="password" autoComplete="off" value={apiKeyInput} disabled={!canEdit} placeholder={apiKeyConfigured ? '••••••••' : t('apiKeyPlaceholder')} onChange={(e) => setApiKeyInput(e.target.value)} className="w-full bg-surface-elevated border border-subtle rounded-xl px-4 py-2.5 text-sm text-primary outline-none disabled:opacity-60" />
        <p className="mt-1 text-[10px] text-secondary italic">{t('apiKeyHint')}</p>
      </div>

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-subtle">
        <button type="button" disabled={!canEdit || testing || (!apiKeyConfigured && !apiKeyInput)} onClick={handleTest} className="px-4 py-2 rounded-xl text-sm border border-subtle text-primary hover:border-accent disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2">
          {testing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {t('testButton')}
        </button>
        <button type="button" disabled={!canEdit || saving} onClick={() => handleSave()} className="px-4 py-2 rounded-xl text-sm bg-accent text-white hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2">
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {tCommon('save')}
        </button>
      </div>

      {!canEdit && <p className="text-[11px] text-secondary italic">{t('readOnlyHint')}</p>}
    </div>
  );
}
