import Head from 'next/head';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import DocumentEditor from '../components/DocumentEditor';
import LoadingSpinner from '../components/LoadingSpinner';
import { mdToHtml } from '../lib/export-utils';
import { saveDocument } from '../lib/api';
import { useTranslations } from '../lib/i18n';
import { Button } from '../components/ui/button';
import { Card, CardBody } from '../components/ui/card';
import { Field } from '../components/ui/field';
import { Check, Sparkles } from 'lucide-react';
import { cn } from '../lib/utils';

// Only spelling_grammar is enabled — see pages/api/text-optimization.js's
// ALLOWED_PRESETS comment. The other five presets come back once each is
// individually verified with the same rigor.
const PRESETS = [
  { id: 'spelling_grammar', label: 'Rechtschreibung & Grammatik' },
];

export default function Textoptimierung() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const t = useTranslations('textOptPage');
  const [text, setText] = useState('');
  const [preset, setPreset] = useState('spelling_grammar');
  const [customInstruction, setCustomInstruction] = useState('');
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
        body: JSON.stringify({ text, preset, customInstruction }),
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

      <div className="max-w-3xl mx-auto animate-fade-in pb-20">
        <header className="mb-7">
          <p className="text-xs font-medium text-secondary mb-2">{t('eyebrow')}</p>
          <h1 className="text-3xl font-semibold tracking-tight text-primary">{t('title')}</h1>
          <p className="text-sm leading-6 text-secondary mt-2 max-w-2xl">{t('subtitle')}</p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-5">
          <Card>
            <CardBody className="p-5 sm:p-6">
            <Field label={t('input')} htmlFor="text-optimization-input" help={t('inputHelp')}>
            <textarea
              id="text-optimization-input"
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={6}
              placeholder={t('inputPlaceholder')}
              className="w-full bg-surface-elevated border border-subtle rounded-lg px-4 py-3 text-sm text-primary outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent resize-y"
            />
            </Field>
            </CardBody>
          </Card>

          <Card>
            <CardBody className="p-5 sm:p-6 space-y-5">
            <div>
              <p className="text-xs font-medium text-secondary mb-1">{t('preset')}</p>
              <p className="text-xs text-muted mb-3">{t('presetHelp')}</p>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setPreset(entry.id)}
                    aria-pressed={preset === entry.id}
                    className={cn('inline-flex items-center gap-1.5 min-h-10 px-3 py-2 rounded-lg text-xs font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                      preset === entry.id
                        ? 'bg-surface-elevated text-primary border-emphasis'
                        : 'bg-transparent border-subtle text-secondary hover:text-primary hover:bg-hover-subtle'
                    )}
                  >
                    {preset === entry.id && <Check className="w-3.5 h-3.5" aria-hidden="true" />}
                    {t(`presets.${entry.id}`)}
                  </button>
                ))}
              </div>
            </div>

            <Field label={t('customInstruction')} htmlFor="text-optimization-instruction" help={t('instructionHelp')}>
              <textarea
                id="text-optimization-instruction"
                value={customInstruction}
                onChange={(event) => setCustomInstruction(event.target.value)}
                rows={3}
                placeholder={t('customInstructionHint')}
                className="w-full bg-surface-elevated border border-subtle rounded-lg px-4 py-3 text-sm text-primary outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent resize-y"
              />
            </Field>
            </CardBody>
          </Card>

          {error && (
            <div role="alert" className="p-4 border border-danger/30 text-danger rounded-xl text-sm">
              {error}
            </div>
          )}

          <Button
            type="submit"
            disabled={loading || !text.trim()}
            variant="primary"
            size="lg"
            className="w-full"
          >
            <Sparkles className="w-4 h-4" aria-hidden="true" />
            {loading ? t('submitting') : t('submit')}
          </Button>
        </form>
      </div>
    </>
  );
}
