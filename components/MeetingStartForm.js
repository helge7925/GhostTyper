import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { Loader2, Video } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { useTranslations } from '../lib/i18n';
import { useUiFeedback } from '../lib/use-ui-feedback';

const MEET_REGEX = /(?:meet\.google\.com\/)([a-z]{3}-[a-z]{4}-[a-z]{3})/i;
const ZOOM_REGEX = /zoom\.us\/j\/(\d+)/i;
const TEAMS_REGEX = /teams\.(?:microsoft|live)\.com\/[^\s]+meeting/i;

function detectPlatform(url) {
  if (!url) return null;
  if (MEET_REGEX.test(url)) return 'google_meet';
  if (TEAMS_REGEX.test(url)) return 'teams';
  if (ZOOM_REGEX.test(url)) return 'zoom';
  return null;
}

export default function MeetingStartForm({ open, onOpenChange, defaultBotName, defaultLanguage }) {
  const router = useRouter();
  const t = useTranslations('meeting.start');
  const tCommon = useTranslations('common');
  const { showToast } = useUiFeedback();

  const [url, setUrl] = useState('');
  const [botName, setBotName] = useState('');
  const [language, setLanguage] = useState('de');
  const [autoAnalyze, setAutoAnalyze] = useState(true);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Live-translation block. Defaults to OFF; the configured pair (DE↔EN
  // by default) only matters once the toggle is on.
  const [translationEnabled, setTranslationEnabled] = useState(false);
  const [translationLangA, setTranslationLangA] = useState('de');
  const [translationLangB, setTranslationLangB] = useState('en');

  useEffect(() => {
    if (open) {
      setBotName(defaultBotName || '');
      setLanguage(defaultLanguage || 'de');
      setConsent(false);
      setUrl('');
      setAutoAnalyze(true);
      setTranslationEnabled(false);
      setTranslationLangA('de');
      setTranslationLangB('en');
    }
  }, [open, defaultBotName, defaultLanguage]);

  const platform = useMemo(() => detectPlatform(url), [url]);
  const translationLanguagesValid = !translationEnabled || translationLangA !== translationLangB;
  const valid = !!platform && consent && !submitting && translationLanguagesValid;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!valid) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/meetings', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          botName: botName || undefined,
          language,
          autoAnalyze,
          consentAccepted: true,
          translation: translationEnabled
            ? { enabled: true, fromLang: translationLangA, toLang: translationLangB }
            : undefined,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload.message || t('error'));
      }
      showToast(t('success'), 'success');
      onOpenChange(false);
      router.push(`/transcriptions/${payload.id}`);
    } catch (error) {
      showToast(error.message || t('error'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Video className="w-4 h-4" /> {t('title')}
          </DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-secondary mb-1.5">{t('urlLabel')}</label>
            <input
              type="url"
              required
              autoFocus
              placeholder="https://meet.google.com/abc-defg-hij"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full bg-surface-elevated border border-subtle rounded-xl px-4 py-2.5 text-sm text-primary outline-none focus:ring-1 focus:ring-accent"
            />
            <p className="mt-1 text-[10px] text-secondary">
              {platform ? t(`platform.${platform}`) : t('urlHint')}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-secondary mb-1.5">{t('botNameLabel')}</label>
              <input
                type="text"
                value={botName}
                placeholder={defaultBotName || 'GhostTyper Notes'}
                onChange={(e) => setBotName(e.target.value)}
                className="w-full bg-surface-elevated border border-subtle rounded-xl px-4 py-2.5 text-sm text-primary outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary mb-1.5">{t('languageLabel')}</label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full bg-surface-elevated border border-subtle rounded-xl px-4 py-2.5 text-sm text-primary outline-none"
              >
                <option value="de">Deutsch</option>
                <option value="en">English</option>
                <option value="auto">{t('languageAuto')}</option>
              </select>
            </div>
          </div>

          <label className="flex items-start gap-3 text-xs text-secondary">
            <input
              type="checkbox"
              checked={autoAnalyze}
              onChange={(e) => setAutoAnalyze(e.target.checked)}
              className="mt-0.5"
            />
            <span>{t('autoAnalyze')}</span>
          </label>

          <div className="border border-subtle rounded-xl p-3 space-y-2">
            <label className="flex items-start gap-3 text-xs text-secondary">
              <input
                type="checkbox"
                checked={translationEnabled}
                onChange={(e) => setTranslationEnabled(e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-primary font-medium">{t('translation.enable')}</span>
            </label>
            {translationEnabled && (
              <>
                <p className="text-[10px] text-secondary leading-snug">{t('translation.hint')}</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-medium text-secondary mb-1 uppercase tracking-wider">{t('translation.languageA')}</label>
                    <select
                      value={translationLangA}
                      onChange={(e) => setTranslationLangA(e.target.value)}
                      className="w-full bg-surface-elevated border border-subtle rounded-xl px-3 py-2 text-xs text-primary outline-none"
                    >
                      <option value="de">Deutsch</option>
                      <option value="en">English</option>
                      <option value="fr">Français</option>
                      <option value="es">Español</option>
                      <option value="it">Italiano</option>
                      <option value="pt">Português</option>
                      <option value="nl">Nederlands</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-secondary mb-1 uppercase tracking-wider">{t('translation.languageB')}</label>
                    <select
                      value={translationLangB}
                      onChange={(e) => setTranslationLangB(e.target.value)}
                      className="w-full bg-surface-elevated border border-subtle rounded-xl px-3 py-2 text-xs text-primary outline-none"
                    >
                      <option value="en">English</option>
                      <option value="de">Deutsch</option>
                      <option value="fr">Français</option>
                      <option value="es">Español</option>
                      <option value="it">Italiano</option>
                      <option value="pt">Português</option>
                      <option value="nl">Nederlands</option>
                    </select>
                  </div>
                </div>
                {!translationLanguagesValid && (
                  <p className="text-[10px] text-danger">{t('translation.sameLanguageError')}</p>
                )}
                <p className="text-[10px] text-warning">{t('translation.costWarning')}</p>
              </>
            )}
          </div>

          <label className="flex items-start gap-3 text-xs text-primary bg-warning/10 border border-warning/30 rounded-xl px-3 py-2">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5"
              required
            />
            <span>{t('consent')}</span>
          </label>

          <DialogFooter>
            <button
              type="button"
              className="px-4 py-2 rounded-xl text-sm border border-subtle text-primary hover:bg-hover-subtle"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              {tCommon('cancel')}
            </button>
            <button
              type="submit"
              disabled={!valid}
              className="px-4 py-2 rounded-xl text-sm bg-accent text-white hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {t('cta')}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
