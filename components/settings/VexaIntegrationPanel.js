import { useCallback, useEffect, useState } from 'react';
import { Plug, ShieldCheck, ShieldAlert, Loader2 } from 'lucide-react';
import { useTranslations } from '../../lib/i18n';
import { useUiFeedback } from '../../lib/use-ui-feedback';
import { invalidateVexaIntegrationCache } from '../../lib/use-vexa-integration';

const ENDPOINT = '/api/organizations/integrations/vexa';
const TEST_ENDPOINT = '/api/organizations/integrations/vexa/test';

export default function VexaIntegrationPanel({ canEdit }) {
  const t = useTranslations('settings.integrations.vexa');
  const tCommon = useTranslations('common');
  const { showToast } = useUiFeedback();

  // The Vexa base URL and admin token are always operator-managed — set
  // once via ENV in the Compose stack and not user-editable. We don't
  // surface them in the UI any more, so the only fields here are the
  // enable toggle, the default bot name, and the default language.
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [defaultBotName, setDefaultBotName] = useState('');
  const [defaultLanguage, setDefaultLanguage] = useState('de');
  const [gdprNoticeEnabled, setGdprNoticeEnabled] = useState(false);
  const [gdprNoticeText, setGdprNoticeText] = useState('');
  const [healthState, setHealthState] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(ENDPOINT, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const cfg = data.config || {};
      setEnabled(!!data.enabled);
      setDefaultBotName(cfg.defaultBotName || '');
      setDefaultLanguage(cfg.defaultLanguage || 'de');
      setGdprNoticeEnabled(cfg.gdprChatNoticeEnabled === true);
      setGdprNoticeText(cfg.gdprChatNoticeText || '');
    } catch (error) {
      showToast(t('loadError'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  useEffect(() => {
    load();
  }, [load]);

  const persist = async (overrides = {}) => {
    const body = {
      enabled: typeof overrides.enabled === 'boolean' ? overrides.enabled : enabled,
      defaultBotName: defaultBotName || null,
      defaultLanguage: defaultLanguage || 'de',
      gdprChatNoticeEnabled: gdprNoticeEnabled,
      gdprChatNoticeText: gdprNoticeText || null,
    };
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
    invalidateVexaIntegrationCache();
    return res.json();
  };

  const handleToggle = async (next) => {
    if (!canEdit) return;
    setSaving(true);
    try {
      await persist({ enabled: next });
      setEnabled(next);
      showToast(next ? t('saveSuccess') : t('saveSuccess'), 'success');
      await load();
    } catch (error) {
      showToast(error.message || t('saveError'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!canEdit) return;
    setSaving(true);
    try {
      await persist();
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
      const res = await fetch(TEST_ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
      });
      const payload = await res.json().catch(() => ({}));
      if (res.ok && payload.ok) {
        setHealthState({ ok: true });
        showToast(t('testSuccess'), 'success');
      } else {
        setHealthState({ ok: false, message: payload.message });
        showToast(payload.message || t('testError'), 'error');
      }
    } catch (error) {
      setHealthState({ ok: false, message: error.message });
      showToast(error.message || t('testError'), 'error');
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-surface border border-subtle rounded-2xl p-6 shadow-xl animate-fade-in">
        <div className="flex items-center gap-2 text-secondary text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          {tCommon('loading')}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-subtle rounded-2xl p-6 shadow-xl animate-fade-in space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-secondary uppercase tracking-widest flex items-center gap-2">
            <Plug className="w-4 h-4" />
            {t('title')}
          </h2>
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
          <p className="text-xs text-secondary mt-0.5">{t('enableHintSimple')}</p>
        </div>
        <label className="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={enabled}
            disabled={!canEdit || saving}
            onChange={(e) => handleToggle(e.target.checked)}
          />
          <span className="w-10 h-6 rounded-full bg-subtle peer-checked:bg-accent transition-colors relative after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-5 after:h-5 after:bg-white after:rounded-full after:transition-transform peer-checked:after:translate-x-4" />
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-secondary mb-1.5">{t('defaultBotNameLabel')}</label>
          <input
            type="text"
            value={defaultBotName}
            disabled={!canEdit}
            placeholder="GhostTyper Notes"
            onChange={(e) => setDefaultBotName(e.target.value)}
            className="w-full bg-surface-elevated border border-subtle rounded-xl px-4 py-2.5 text-sm text-primary outline-none disabled:opacity-60"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-secondary mb-1.5">{t('defaultLanguageLabel')}</label>
          <select
            value={defaultLanguage}
            disabled={!canEdit}
            onChange={(e) => setDefaultLanguage(e.target.value)}
            className="w-full bg-surface-elevated border border-subtle rounded-xl px-4 py-2.5 text-sm text-primary outline-none disabled:opacity-60"
          >
            <option value="de">Deutsch</option>
            <option value="en">English</option>
            <option value="auto">{t('languageAuto')}</option>
          </select>
        </div>
      </div>

      <div className="border border-subtle rounded-xl p-4 space-y-3 bg-hover-subtle/40">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <p className="text-sm text-primary font-medium">{t('gdprNoticeLabel')}</p>
            <p className="text-xs text-secondary mt-0.5 leading-snug">{t('gdprNoticeHint')}</p>
          </div>
          <label className="inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={gdprNoticeEnabled}
              disabled={!canEdit}
              onChange={(e) => setGdprNoticeEnabled(e.target.checked)}
            />
            <span className="w-10 h-6 rounded-full bg-subtle peer-checked:bg-accent transition-colors relative after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-5 after:h-5 after:bg-white after:rounded-full after:transition-transform peer-checked:after:translate-x-4" />
          </label>
        </div>
        {gdprNoticeEnabled && (
          <div>
            <label className="block text-xs font-medium text-secondary mb-1.5">{t('gdprNoticeTextLabel')}</label>
            <textarea
              rows={3}
              value={gdprNoticeText}
              disabled={!canEdit}
              placeholder={t('gdprNoticeTextPlaceholder')}
              onChange={(e) => setGdprNoticeText(e.target.value.slice(0, 1000))}
              className="w-full bg-surface-elevated border border-subtle rounded-xl px-3 py-2 text-xs text-primary outline-none disabled:opacity-60 leading-relaxed"
            />
            <p className="mt-1 text-[10px] text-secondary italic">{t('gdprNoticeTextHint')}</p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-subtle">
        <button
          type="button"
          disabled={!canEdit || testing || !enabled}
          onClick={handleTest}
          className="px-4 py-2 rounded-xl text-sm border border-subtle text-primary hover:border-accent disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
          title={!enabled ? t('testRequiresEnable') : undefined}
        >
          {testing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {t('testButton')}
        </button>
        <button
          type="button"
          disabled={!canEdit || saving}
          onClick={handleSave}
          className="px-4 py-2 rounded-xl text-sm bg-accent text-white hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
        >
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {tCommon('save')}
        </button>
      </div>

      {!canEdit && (
        <p className="text-[11px] text-secondary italic">{t('readOnlyHint')}</p>
      )}
    </div>
  );
}
