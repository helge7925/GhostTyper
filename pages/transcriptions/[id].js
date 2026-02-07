import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState, useEffect } from 'react';
import StatusBadge from '../../components/StatusBadge';
import LoadingSpinner from '../../components/LoadingSpinner';
import { getTranscription } from '../../lib/api';
import { STATUS } from '../../lib/constants';

const MOCK_DETAIL = {
  '1': {
    id: '1',
    filename: 'interview_2024.mp3',
    status: STATUS.COMPLETED,
    createdAt: '2024-01-15T10:30:00Z',
    text: 'Dies ist ein Beispiel-Transkriptionstext. In einem echten Szenario würde hier der vollständige transkribierte Text der Audio-Datei stehen. Der Text kann mehrere Absätze umfassen und verschiedene Sprecher enthalten.',
    analysis: 'Zusammenfassung: Das Interview behandelt die Themen Digitalisierung und Künstliche Intelligenz im Arbeitsalltag. Hauptthemen: Automatisierung, Effizienzsteigerung, Datenschutz.',
  },
  '2': {
    id: '2',
    filename: 'meeting_notes.wav',
    status: STATUS.PROCESSING,
    createdAt: '2024-01-16T14:00:00Z',
    text: null,
    analysis: null,
  },
  '3': {
    id: '3',
    filename: 'podcast_episode.ogg',
    status: STATUS.PENDING,
    createdAt: '2024-01-17T09:15:00Z',
    text: null,
    analysis: null,
  },
};

export default function TranscriptionDetail() {
  const router = useRouter();
  const { id } = router.query;
  const [transcription, setTranscription] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    getTranscription(id)
      .then(setTranscription)
      .catch(() => setTranscription(MOCK_DETAIL[id] || null))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <LoadingSpinner />;

  if (!transcription) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 text-lg">Transkription nicht gefunden.</p>
        <Link href="/transcriptions" className="text-blue-600 hover:underline mt-4 inline-block">
          Zurück zur Übersicht
        </Link>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>{transcription.filename} - Transkription WebApp</title>
      </Head>

      <Link href="/transcriptions" className="text-blue-600 hover:underline text-sm mb-4 inline-block">
        &larr; Zurück zur Übersicht
      </Link>

      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">
            {transcription.filename}
          </h1>
          <StatusBadge status={transcription.status} />
        </div>

        <p className="text-sm text-gray-500">
          Erstellt am{' '}
          {new Date(transcription.createdAt).toLocaleDateString('de-DE', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>

        <section>
          <h2 className="text-lg font-semibold text-gray-800 mb-2">Transkription</h2>
          {transcription.text ? (
            <div className="bg-white border border-gray-200 rounded-lg p-4 whitespace-pre-wrap text-gray-700">
              {transcription.text}
            </div>
          ) : (
            <p className="text-gray-400 italic">
              {transcription.status === STATUS.PROCESSING
                ? 'Transkription wird verarbeitet...'
                : 'Noch keine Transkription verfügbar.'}
            </p>
          )}
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-800 mb-2">Analyse</h2>
          {transcription.analysis ? (
            <div className="bg-white border border-gray-200 rounded-lg p-4 text-gray-700">
              {transcription.analysis}
            </div>
          ) : (
            <p className="text-gray-400 italic">Noch keine Analyse verfügbar.</p>
          )}
        </section>
      </div>
    </>
  );
}
