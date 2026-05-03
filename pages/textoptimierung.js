import Head from 'next/head';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import DocumentEditor from '../components/DocumentEditor';
import LoadingSpinner from '../components/LoadingSpinner';
import { mdToHtml } from '../lib/export-utils';
import { saveDocument } from '../lib/api';
import { useTranslations } from '../lib/i18n';

const PRESETS = [
  { id: 'spelling_grammar', label: 'Rechtschreibung & Grammatik' },
  { id: 'friendlier', label: 'Freundlicher' },
  { id: 'more_formal', label: 'Formeller' },
  { id: 'shorter', label: 'Kürzer' },
  { id: 'clearer', label: 'Klarer' },
  { id: 'email_improve', label: 'E-Mail verbessern' },
];

export default function Textoptimierung() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const t = useTranslations('textOptPage');
  const [text, setText] = useState('');
  const [preset, setPreset] = useState('spelling_grammar');
  const [customInstruction, setCustomInstruction] = useState('');
  const [model, setModel] = useState('mistral-large-latest');
  const [optimizedText, setOptimizedText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!text.trim() || loading) return;
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/text-optimization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, preset, customInstruction, model }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message || 'Textoptimierung fehlgeschlagen');
      }
      setOptimizedText(payload.optimizedText || '');
    } catch (err) {
      setError(err.message || 'Textoptimierung fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveDocument(html) {
    await saveDocument({
      title: `Textoptimierung (${new Date().toLocaleDateString('de-DE')})`,
      text,
      documentHtml: html,
      template: 'text_optimization',
    });
  }

  if (status === 'loading') return <LoadingSpinner />;
  if (!session) return <LoadingSpinner />;

  if (optimizedText) {
    return (
      <DocumentEditor
        initialHtml={mdToHtml(optimizedText)}
        filename="Textoptimierung"
        sidebarContent={text}
        sourceLabel="Originaltext"
        onSave={handleSaveDocument}
        onCancel={() => setOptimizedText('')}
      />
    );
  }

  return (
    <>
      <Head>
        <title>{`${t('title')} – GhostTyper`}</title>
      </Head>

      <div className="max-w-5xl mx-auto animate-fade-in pb-20">
        <div className="mb-8">
          <p className="text-[10px] uppercase tracking-[0.22em] text-secondary">{t('title')}</p>
          <h1 className="text-2xl font-bold text-primary mt-1">{t('title')}</h1>
          <p className="text-sm text-secondary mt-2 max-w-2xl">{t('subtitle')}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="bg-surface border border-subtle rounded-2xl p-5">
            <label htmlFor="text-optimization-input" className="block text-xs font-bold uppercase tracking-widest text-secondary mb-3">
              {t('input')}
            </label>
            <textarea
              id="text-optimization-input"
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={6}
              placeholder={t('input')}
              className="w-full bg-surface-elevated border border-subtle rounded-xl px-4 py-3 text-sm text-primary outline-none focus:ring-1 focus:ring-accent resize-y"
            />
          </div>

          <div className="bg-surface border border-subtle rounded-2xl p-5 space-y-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-secondary mb-3">{t('preset')}</p>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setPreset(entry.id)}
                    className={`px-3 py-2 rounded-xl text-xs border transition-colors ${
                      preset === entry.id
                        ? 'bg-accent text-white border-accent'
                        : 'bg-hover-subtle border-subtle text-primary hover:border-accent/40'
                    }`}
                  >
                    {t(`presets.${entry.id}`)}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="text-optimization-instruction" className="block text-xs font-bold uppercase tracking-widest text-secondary mb-2">
                  {t('customInstruction')}
                </label>
                <textarea
                  id="text-optimization-instruction"
                  value={customInstruction}
                  onChange={(event) => setCustomInstruction(event.target.value)}
                  rows={3}
                  placeholder={t('customInstructionHint')}
                  className="w-full bg-surface-elevated border border-subtle rounded-xl px-4 py-3 text-sm text-primary outline-none focus:ring-1 focus:ring-accent resize-y"
                />
              </div>
              <div>
                <label htmlFor="text-optimization-model" className="block text-xs font-bold uppercase tracking-widest text-secondary mb-2">
                  KI-Modell
                </label>
                <select
                  id="text-optimization-model"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  className="w-full bg-surface-elevated border border-subtle rounded-xl px-4 py-3 text-sm text-primary outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value="mistral-small-latest">Kostengünstig / Schnell</option>
                  <option value="mistral-medium-latest">Ausgewogen</option>
                  <option value="mistral-large-latest">Qualität</option>
                </select>
              </div>
            </div>
          </div>

          {error && (
            <div className="p-4 bg-danger/10 border border-danger/20 text-danger rounded-2xl text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !text.trim()}
            className="w-full gradient-accent text-white py-3 rounded-xl text-sm font-bold shadow-lg shadow-accent/20 disabled:opacity-30"
          >
            {loading ? t('submitting') : t('submit')}
          </button>
        </form>
      </div>
    </>
  );
}
