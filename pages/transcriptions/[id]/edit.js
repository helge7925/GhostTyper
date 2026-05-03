import Head from 'next/head';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import DocumentEditor from '../../../components/DocumentEditor';
import LoadingSpinner from '../../../components/LoadingSpinner';
import { toast } from 'sonner';
import { getTranscription } from '../../../lib/api';
import { analysisToHtml } from '../../../lib/export-utils';

/**
 * Document-editor page. Renders without the standard Layout (handled in _app.js
 * via noLayoutRoutes), so the editor's `fixed inset-0` shell takes the whole
 * viewport. Returning to /transcriptions/[id] is done via router.back().
 */
export default function TranscriptionEditPage() {
  const router = useRouter();
  const { id } = router.query;
  const { status: authStatus } = useSession();

  const [transcription, setTranscription] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.replace(`/login?next=/transcriptions/${id}/edit`);
      return;
    }
    if (!id || authStatus !== 'authenticated') return;

    let cancelled = false;
    getTranscription(id)
      .then((data) => {
        if (cancelled) return;
        setTranscription(data);
      })
      .catch(() => {
        if (cancelled) return;
        setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, authStatus, router]);

  const initialHtml = useMemo(() => {
    if (!transcription) return '';
    return transcription.document_html || analysisToHtml(transcription);
  }, [transcription]);

  const handleSave = useCallback(
    async (html) => {
      const response = await fetch(`/api/transcriptions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentHtml: html }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.message || 'Speichern fehlgeschlagen');
      }
      toast.success('Dokument gespeichert');
    },
    [id],
  );

  const handleCancel = useCallback(() => {
    if (window.history.length > 1) router.back();
    else router.replace(`/transcriptions/${id}`);
  }, [id, router]);

  if (loading) {
    return (
      <>
        <Head>
          <title>Editor wird geladen – GhostTyper</title>
        </Head>
        <div className="fixed inset-0 z-[60] bg-canvas flex items-center justify-center">
          <LoadingSpinner />
        </div>
      </>
    );
  }

  if (notFound || !transcription) {
    return (
      <>
        <Head>
          <title>Nicht gefunden – GhostTyper</title>
        </Head>
        <div className="fixed inset-0 z-[60] bg-canvas flex flex-col items-center justify-center gap-3 text-center px-6">
          <h1 className="text-lg font-semibold text-primary">Eintrag nicht gefunden</h1>
          <p className="text-sm text-secondary">Diese Transkription existiert nicht oder gehört nicht zu Ihrem Konto.</p>
          <button
            onClick={() => router.replace('/transcriptions')}
            className="mt-2 px-4 py-2 rounded-xl border border-subtle text-secondary hover:text-primary hover:bg-hover-subtle transition-colors"
          >
            Zur Historie
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>{`${transcription.original_name} – Editor`}</title>
      </Head>
      <DocumentEditor
        initialHtml={initialHtml}
        filename={transcription.original_name}
        sidebarContent={transcription.text}
        sourceLabel="Transkript"
        onSave={handleSave}
        onCancel={handleCancel}
      />
    </>
  );
}
