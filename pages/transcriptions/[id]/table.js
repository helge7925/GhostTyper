import Head from 'next/head';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import TableEditor from '../../../components/TableEditor';
import LoadingSpinner from '../../../components/LoadingSpinner';
import { toast } from 'sonner';
import { getTranscription } from '../../../lib/api';

/**
 * Table-editor page. Sibling to /transcriptions/[id]/edit but for table-mode
 * analyses. Mounts TableEditor full-screen without the app shell.
 */
export default function TranscriptionTableEditPage() {
  const router = useRouter();
  const { id } = router.query;
  const { status: authStatus } = useSession();

  const [transcription, setTranscription] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.replace(`/login?next=/transcriptions/${id}/table`);
      return;
    }
    if (!id || authStatus !== 'authenticated') return;

    let cancelled = false;
    getTranscription(id)
      .then((data) => {
        if (cancelled) return;
        if (!(data?.analysis_type === 'table' && data?.table_schema)) {
          // Not a table analysis — bounce back to the doc editor instead.
          router.replace(`/transcriptions/${id}/edit`);
          return;
        }
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

  const initialData = useMemo(() => {
    if (!transcription) return { metadata: {}, rows: [] };
    return {
      ...(transcription.analysis || {}),
      ...(transcription.analysis_meta || {}),
    };
  }, [transcription]);

  const handleSave = useCallback(
    async (tableData) => {
      const response = await fetch(`/api/transcriptions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableData }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message || 'Tabelle konnte nicht gespeichert werden.');
      }
      setTranscription((prev) =>
        prev
          ? {
              ...prev,
              analysis: {
                metadata: tableData.metadata || {},
                rows: tableData.rows || [],
              },
              analysis_meta: {
                ...(prev.analysis_meta || {}),
                missing_fields_by_row: tableData.missing_fields_by_row || [],
                missing_metadata_fields: tableData.missing_metadata_fields || [],
              },
              updated_at: new Date().toISOString(),
            }
          : prev,
      );
      toast.success('Tabelle gespeichert');
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
          <title>Tabellen-Editor wird geladen – GhostTyper</title>
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
        <title>{`${transcription.original_name} – Tabellen-Editor`}</title>
      </Head>
      <TableEditor
        initialData={initialData}
        schema={transcription.table_schema}
        filename={transcription.original_name}
        sidebarContent={transcription.text}
        sourceLabel="Transkript"
        onSave={handleSave}
        onCancel={handleCancel}
      />
    </>
  );
}
