import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { useEffect, useState, useCallback } from 'react';
import LoadingSpinner from '../../components/LoadingSpinner';
import Toast from '../../components/Toast';
import { deleteDocument, getDocument, reindexDocument, updateDocument } from '../../lib/api';

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('de-DE');
}

export default function DocumentDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const { status } = useSession();
  const [document, setDocument] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      setDocument(await getDocument(id));
    } catch (error) {
      setToast({ type: 'error', message: error.message || 'Datei konnte nicht geladen werden.' });
      setDocument(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
    if (status === 'authenticated') load();
  }, [status, router, load]);

  const editTags = async () => {
    const current = Array.isArray(document.tags) ? document.tags.join(', ') : '';
    const next = window.prompt('Tags kommagetrennt bearbeiten', current);
    if (next === null) return;
    const tags = next.split(',').map((tag) => tag.trim()).filter(Boolean);
    try {
      setDocument(await updateDocument(document.id, { tags }));
    } catch (error) {
      setToast({ type: 'error', message: error.message || 'Tags konnten nicht gespeichert werden.' });
    }
  };

  const runReindex = async () => {
    setBusy(true);
    try {
      await reindexDocument(document.id);
      await load();
      setToast({ type: 'success', message: 'Index wurde erstellt.' });
    } catch (error) {
      setToast({ type: 'error', message: error.message || 'Index konnte nicht erstellt werden.' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm('Datei wirklich löschen?')) return;
    setBusy(true);
    try {
      await deleteDocument(document.id);
      router.push('/transcriptions');
    } catch (error) {
      setToast({ type: 'error', message: error.message || 'Datei konnte nicht gelöscht werden.' });
      setBusy(false);
    }
  };

  if (status === 'loading' || loading) return <LoadingSpinner />;
  if (!document) return <LoadingSpinner />;

  const title = document.title || document.original_name || `Datei ${document.id}`;
  const body = document.text || document.summary || document.text_preview || 'Keine Vorschau verfügbar.';

  return (
    <>
      <Head><title>{`${title} - GhostTyper`}</title></Head>
      <div className="max-w-6xl mx-auto animate-fade-in pb-20">
        <button onClick={() => router.push('/transcriptions')} className="text-secondary hover:text-primary text-xs mb-6">Zurück zu Dateien</button>
        <div className="bg-surface border border-subtle rounded-2xl p-6 shadow-xl mb-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-primary">{title}</h1>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-secondary">
                <span>{document.source_type}</span>
                <span>{document.visibility === 'private' ? 'Privat' : 'Workspace'}</span>
                <span>{formatDate(document.updated_at)}</span>
                <span>{Number(document.chunk_count || 0)} Chunks</span>
              </div>
              {Array.isArray(document.tags) && document.tags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {document.tags.map((tag) => <span key={tag} className="px-2 py-0.5 rounded-full bg-accent/10 text-accent text-xs">#{tag}</span>)}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {document.transcription_id && <Link href={`/transcriptions/${document.transcription_id}`} className="px-3 py-2 rounded-lg bg-accent text-white text-xs font-semibold">Transkript öffnen</Link>}
              <button type="button" onClick={editTags} className="px-3 py-2 rounded-lg border border-subtle text-xs text-primary">Tags</button>
              <button type="button" disabled={busy} onClick={runReindex} className="px-3 py-2 rounded-lg border border-subtle text-xs text-primary disabled:opacity-50">Index neu</button>
              <button type="button" disabled={busy} onClick={remove} className="px-3 py-2 rounded-lg bg-danger/10 text-danger text-xs font-semibold disabled:opacity-50">Löschen</button>
            </div>
          </div>
        </div>
        <div className="bg-surface border border-subtle rounded-2xl p-6 shadow-xl">
          <h2 className="text-xs font-bold text-primary uppercase tracking-widest opacity-60 mb-4">Vorschau</h2>
          <div className="text-sm text-secondary leading-relaxed whitespace-pre-wrap max-h-[65vh] overflow-y-auto custom-scrollbar">{body}</div>
        </div>
      </div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  );
}
