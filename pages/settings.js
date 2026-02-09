import Head from 'next/head';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { useState, useEffect, useCallback } from 'react';
import { getSettings, updateSettings } from '../lib/api';

export default function Settings() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [apiKey, setApiKey] = useState('');
  const [defaultTemplate, setDefaultTemplate] = useState('meeting');
  const [language, setLanguage] = useState('de');
  const [contextBias, setContextBias] = useState('');
  const [preferredModel, setPreferredModel] = useState('mistral-large-latest');
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [usage, setUsage] = useState(null);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
      return;
    }
    if (status !== 'authenticated') return;

    getSettings()
      .then((data) => {
        setApiKeyConfigured(data.apiKeyConfigured);
        setDefaultTemplate(data.defaultTemplate || 'meeting');
        setLanguage(data.language || 'de');
        setContextBias(data.contextBias || '');
        setPreferredModel(data.preferredModel || 'mistral-large-latest');
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    fetch('/api/usage')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setUsage(data); })
      .catch(() => {});
  }, [status, router]);

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    setSaved(false);

    try {
      await updateSettings({
        mistralApiKey: apiKey || undefined,
        defaultTemplate,
        language,
        contextBias,
        preferredModel,
      });
      setSaved(true);
      if (apiKey) {
        setApiKeyConfigured(true);
        setApiKey('');
      }
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError('Einstellungen konnten nicht gespeichert werden.');
    }
  }

  if (status === 'loading' || loading) return null;
  if (!session) return null;

  return (
    <>
      <Head>
        <title>Einstellungen - GhostTyper</title>
      </Head>

      <h1 className="text-2xl font-semibold text-text-primary mb-6">Einstellungen</h1>

      <form onSubmit={handleSave} className="max-w-lg space-y-6">
        <div className="bg-dark-card border border-white/[0.06] rounded-xl p-6">
          <h2 className="text-base font-medium text-text-primary mb-4">Mistral API</h2>

          <div className="mb-4">
            <label htmlFor="apiKey" className="block text-sm font-medium text-text-secondary mb-1.5">
              API-Key
            </label>
            <input
              id="apiKey"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={apiKeyConfigured ? 'Gespeichert (zum Ändern neuen Key eingeben)' : 'Mistral API-Key eingeben'}
              className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder-text-secondary focus:ring-2 focus:ring-accent-purple focus:border-accent-purple outline-none transition-shadow"
            />
            <p className="text-xs text-text-secondary mt-1.5">
              Wird für die Transkription (Voxtral) und Analyse (Mistral Large) benötigt.
              Ihren Key finden Sie unter{' '}
              <a href="https://console.mistral.ai/api-keys/" target="_blank" rel="noopener noreferrer" className="text-accent-purple hover:underline">
                console.mistral.ai
              </a>.
            </p>
            {apiKeyConfigured && (
              <p className="text-xs text-accent-green mt-1 flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                API-Key ist konfiguriert
              </p>
            )}
          </div>
        </div>

        <div className="bg-dark-card border border-white/[0.06] rounded-xl p-6">
          <h2 className="text-base font-medium text-text-primary mb-4">Voreinstellungen</h2>

          <div className="mb-4">
            <label htmlFor="template" className="block text-sm font-medium text-text-secondary mb-1.5">
              Standard-Template
            </label>
            <select
              id="template"
              value={defaultTemplate}
              onChange={(e) => setDefaultTemplate(e.target.value)}
              className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary focus:ring-2 focus:ring-accent-purple focus:border-accent-purple outline-none"
            >
              <option value="meeting">Meeting-Protokoll</option>
              <option value="aufmass">Aufmaß</option>
              <option value="generic">Allgemein</option>
            </select>
            <p className="text-xs text-text-secondary mt-1.5">
              Bestimmt, wie die Analyse strukturiert wird.
            </p>
          </div>

          <div className="mb-4">
            <label htmlFor="language" className="block text-sm font-medium text-text-secondary mb-1.5">
              Sprache
            </label>
            <select
              id="language"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary focus:ring-2 focus:ring-accent-purple focus:border-accent-purple outline-none"
            >
              <option value="de">Deutsch</option>
              <option value="en">Englisch</option>
            </select>
          </div>

          <div>
            <label htmlFor="preferredModel" className="block text-sm font-medium text-text-secondary mb-1.5">
              Analyse-Modell
            </label>
            <select
              id="preferredModel"
              value={preferredModel}
              onChange={(e) => setPreferredModel(e.target.value)}
              className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary focus:ring-2 focus:ring-accent-purple focus:border-accent-purple outline-none"
            >
              <option value="mistral-large-latest">Mistral Large (beste Qualität)</option>
              <option value="mistral-medium-latest">Mistral Medium (ausgewogen)</option>
              <option value="mistral-small-latest">Mistral Small (schnell & günstig)</option>
            </select>
            <p className="text-xs text-text-secondary mt-1.5">
              Wird für die Analyse verwendet. Transkription nutzt immer Voxtral Mini.
            </p>
          </div>
        </div>

        <div className="bg-dark-card border border-white/[0.06] rounded-xl p-6">
          <h2 className="text-base font-medium text-text-primary mb-4">Kontextwörter</h2>

          <div>
            <label htmlFor="contextBias" className="block text-sm font-medium text-text-secondary mb-1.5">
              Begriffe für bessere Erkennung
            </label>
            <textarea
              id="contextBias"
              value={contextBias}
              onChange={(e) => setContextBias(e.target.value)}
              placeholder="z.B. Fachbegriffe, Namen, Firmennamen (kommagetrennt)"
              rows={3}
              className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder-text-secondary focus:ring-2 focus:ring-accent-purple focus:border-accent-purple outline-none resize-none"
            />
            <p className="text-xs text-text-secondary mt-1.5">
              Kommagetrennte Liste von Wörtern, die bei der Transkription bevorzugt erkannt werden sollen.
              Hilfreich für Fachbegriffe, Eigennamen oder Abkürzungen.
            </p>
          </div>
        </div>

        {saved && (
          <div className="bg-accent-green/10 border border-accent-green/20 text-accent-green px-4 py-3 rounded-lg text-sm">
            Einstellungen gespeichert.
          </div>
        )}

        {error && (
          <p className="text-sm text-accent-red">{error}</p>
        )}

        <button
          type="submit"
          className="gradient-accent text-white py-2.5 px-6 rounded-full text-sm font-medium transition-colors"
        >
          Speichern
        </button>
      </form>

      {usage && (
        <div className="max-w-lg mt-8">
          <div className="bg-dark-card border border-white/[0.06] rounded-xl p-6">
            <h2 className="text-base font-medium text-text-primary mb-4">
              Nutzung im {new Date().toLocaleString('de', { month: 'long', year: 'numeric' })}
            </h2>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <p className="text-xs text-text-secondary">Anfragen</p>
                <p className="text-lg font-semibold text-text-primary">{usage.totalRequests}</p>
              </div>
              <div>
                <p className="text-xs text-text-secondary">Geschätzte Kosten</p>
                <p className="text-lg font-semibold text-text-primary">{usage.totalCost.toFixed(4)} EUR</p>
              </div>
              <div>
                <p className="text-xs text-text-secondary">Input-Tokens</p>
                <p className="text-sm text-text-primary">{usage.totalInputTokens.toLocaleString('de')}</p>
              </div>
              <div>
                <p className="text-xs text-text-secondary">Output-Tokens</p>
                <p className="text-sm text-text-primary">{usage.totalOutputTokens.toLocaleString('de')}</p>
              </div>
            </div>

            {usage.costLimit && (
              <div className="mt-3">
                <div className="flex justify-between text-xs text-text-secondary mb-1">
                  <span>Kostenlimit</span>
                  <span>{usage.totalCost.toFixed(2)} / {usage.costLimit.toFixed(2)} EUR</span>
                </div>
                <div className="w-full bg-white/[0.06] rounded-full h-2">
                  <div
                    className="h-2 rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, (usage.totalCost / usage.costLimit) * 100)}%`,
                      background: usage.totalCost / usage.costLimit > 0.9
                        ? 'var(--accent-red, #ff6b6b)'
                        : usage.totalCost / usage.costLimit > 0.7
                          ? 'var(--accent-yellow, #feca57)'
                          : 'var(--accent-green, #00cec9)',
                    }}
                  />
                </div>
              </div>
            )}

            {usage.byOperation.length > 0 && (
              <div className="mt-4 border-t border-white/[0.06] pt-3">
                <p className="text-xs text-text-secondary mb-2">Nach Typ</p>
                {usage.byOperation.map((op) => (
                  <div key={op.operation} className="flex justify-between text-sm py-1">
                    <span className="text-text-secondary capitalize">{op.operation}</span>
                    <span className="text-text-primary">{op.requests}x — {op.cost.toFixed(4)} EUR</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
