import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { useEffect, useMemo, useState } from 'react';
import AudioUploadForm from '../components/AudioUploadForm';
import LoadingSpinner from '../components/LoadingSpinner';
import { getTemplateCategories, getTemplates } from '../lib/api';

function templateMatchesCategory(template, categoryId) {
  if (!categoryId || categoryId === 'all') return true;
  if (categoryId === 'uncategorized') return !template.category_id;
  return String(template.category_id || '') === String(categoryId);
}

export default function TabellenTranskription() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [templates, setTemplates] = useState([]);
  const [templateCategories, setTemplateCategories] = useState([]);
  const [activeCategoryId, setActiveCategoryId] = useState('all');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    setLoadingTemplates(true);
    Promise.all([getTemplates(), getTemplateCategories()])
      .then(([items, categories]) => {
        const tableTemplates = (items || []).filter((template) => template.template_type === 'table');
        setTemplates(tableTemplates);
        setTemplateCategories(categories || []);
        setSelectedTemplateId((current) => (
          current && tableTemplates.some((template) => String(template.id) === String(current))
            ? current
            : String(tableTemplates[0]?.id || '')
        ));
      })
      .catch(() => setError('Tabellen-Vorlagen konnten nicht geladen werden.'))
      .finally(() => setLoadingTemplates(false));
  }, [status]);

  const filteredTemplates = useMemo(
    () => templates.filter((template) => templateMatchesCategory(template, activeCategoryId)),
    [templates, activeCategoryId]
  );
  const selectedTemplate = useMemo(
    () => filteredTemplates.find((template) => String(template.id) === String(selectedTemplateId)) || null,
    [filteredTemplates, selectedTemplateId]
  );
  const uploadPresetConfig = useMemo(() => ({
    uploadMode: 'file',
    autoAnalyze: true,
    diarize: false,
    template: `custom-${selectedTemplateId}`,
    model: 'mistral-large-latest',
    showAdvancedOptions: true,
  }), [selectedTemplateId]);
  const uncategorizedCount = templates.filter((template) => !template.category_id).length;

  useEffect(() => {
    if (!filteredTemplates.length) {
      setSelectedTemplateId('');
      return;
    }
    setSelectedTemplateId((current) => (
      current && filteredTemplates.some((template) => String(template.id) === String(current))
        ? current
        : String(filteredTemplates[0].id)
    ));
  }, [filteredTemplates]);

  async function handleSuccess(uploadResult) {
    if (!uploadResult?.id) return;
    setStarting(true);
    setError('');
    try {
      const response = await fetch(`/api/transcriptions/${uploadResult.id}/process`, {
        method: 'POST',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message || 'Verarbeitung konnte nicht gestartet werden.');
      }
      router.push(`/transcriptions/${uploadResult.id}`);
    } catch (err) {
      setError(err.message || 'Tabellen-Transkription konnte nicht gestartet werden.');
    } finally {
      setStarting(false);
    }
  }

  if (status === 'loading' || loadingTemplates || !session) return <LoadingSpinner />;

  return (
    <>
      <Head>
        <title>Tabellen-Transkription - GhostTyper</title>
      </Head>

      <div className="max-w-5xl mx-auto animate-fade-in pb-20 space-y-6">
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-secondary">Feste Tabellen-Vorlage</p>
          <h1 className="text-2xl font-bold text-primary mt-1">Tabellen-Transkription</h1>
          <p className="text-sm text-secondary mt-2 max-w-2xl">
            Audio wird transkribiert und anschließend in eine von Ihnen definierte Tabellen-Vorlage einsortiert.
          </p>
        </div>

        {templates.length === 0 ? (
          <div className="bg-surface border border-subtle rounded-2xl p-6">
            <h2 className="text-sm font-semibold text-primary">Keine Tabellen-Vorlage vorhanden</h2>
            <p className="text-xs text-secondary mt-2">
              Legen Sie zuerst in den Einstellungen eine Tabellen-Vorlage mit Metadaten, Zeilen und Spalten an.
            </p>
            <Link
              href="/settings?tab=table-templates"
              className="mt-5 inline-flex gradient-accent text-white px-5 py-2.5 rounded-xl text-sm font-semibold shadow-lg shadow-accent/20"
            >
              Tabellen-Vorlage anlegen
            </Link>
          </div>
        ) : (
          <>
            <div className="bg-surface border border-subtle rounded-2xl p-5">
              <div className="mb-5">
                <p className="block text-xs font-bold uppercase tracking-widest text-secondary mb-2">
                  Kategorie
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveCategoryId('all')}
                    className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                      activeCategoryId === 'all'
                        ? 'bg-accent text-white border-accent'
                        : 'bg-hover-subtle border-subtle text-primary hover:border-accent/40'
                    }`}
                  >
                    Alle ({templates.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveCategoryId('uncategorized')}
                    className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                      activeCategoryId === 'uncategorized'
                        ? 'bg-accent text-white border-accent'
                        : 'bg-hover-subtle border-subtle text-primary hover:border-accent/40'
                    }`}
                  >
                    Ohne Kategorie ({uncategorizedCount})
                  </button>
                  {templateCategories.map((category) => {
                    const count = templates.filter((template) => String(template.category_id || '') === String(category.id)).length;
                    return (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() => setActiveCategoryId(String(category.id))}
                        className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                          String(activeCategoryId) === String(category.id)
                            ? 'bg-accent text-white border-accent'
                            : 'bg-hover-subtle border-subtle text-primary hover:border-accent/40'
                        }`}
                      >
                        {category.name} ({count})
                      </button>
                    );
                  })}
                </div>
              </div>

              <label htmlFor="table-template-select" className="block text-xs font-bold uppercase tracking-widest text-secondary mb-2">
                Tabellen-Vorlage
              </label>
              {filteredTemplates.length > 0 ? (
                <select
                  id="table-template-select"
                  value={selectedTemplateId}
                  onChange={(event) => setSelectedTemplateId(event.target.value)}
                  className="w-full bg-surface-elevated border border-subtle rounded-xl px-4 py-3 text-sm text-primary outline-none focus:ring-1 focus:ring-accent"
                >
                  {filteredTemplates.map((template) => (
                    <option key={template.id} value={template.id}>{template.name}</option>
                  ))}
                </select>
              ) : (
                <div className="rounded-xl border border-subtle bg-hover-subtle px-4 py-3 text-sm text-secondary">
                  In dieser Kategorie gibt es noch keine Tabellen-Vorlagen.
                </div>
              )}
              {selectedTemplate?.table_schema && (
                <p className="text-[11px] text-secondary mt-2">
                  {(selectedTemplate.table_schema.metadata?.length || 0)} Metadaten,
                  {' '}{(selectedTemplate.table_schema.rows?.length || 0)} Zeilen,
                  {' '}{(selectedTemplate.table_schema.columns?.length || 0)} Spalten
                </p>
              )}
            </div>

            <div className="bg-surface border border-subtle rounded-2xl p-6">
              {selectedTemplate ? (
                <AudioUploadForm
                  key={selectedTemplateId}
                  onSuccess={handleSuccess}
                  lockTemplate
                  templateLabel={selectedTemplate.name || 'Tabellen-Vorlage'}
                  presetConfig={uploadPresetConfig}
                />
              ) : (
                <p className="text-sm text-secondary">
                  Wählen Sie eine Kategorie mit mindestens einer Tabellen-Vorlage aus, um eine Tabellen-Transkription zu starten.
                </p>
              )}
              {starting && (
                <p className="text-xs text-info mt-3">Tabellen-Verarbeitung wird gestartet…</p>
              )}
            </div>
          </>
        )}

        {error && (
          <div className="p-4 bg-danger/10 border border-danger/20 text-danger rounded-2xl text-sm">
            {error}
          </div>
        )}
      </div>
    </>
  );
}
