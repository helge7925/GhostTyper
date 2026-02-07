import Head from 'next/head';
import { useState, useEffect } from 'react';
import TranscriptionCard from '../components/TranscriptionCard';
import LoadingSpinner from '../components/LoadingSpinner';
import { getTranscriptions } from '../lib/api';
import { STATUS } from '../lib/constants';

const MOCK_DATA = [
  {
    id: '1',
    filename: 'interview_2024.mp3',
    status: STATUS.COMPLETED,
    createdAt: '2024-01-15T10:30:00Z',
  },
  {
    id: '2',
    filename: 'meeting_notes.wav',
    status: STATUS.PROCESSING,
    createdAt: '2024-01-16T14:00:00Z',
  },
  {
    id: '3',
    filename: 'podcast_episode.ogg',
    status: STATUS.PENDING,
    createdAt: '2024-01-17T09:15:00Z',
  },
];

export default function Transcriptions() {
  const [transcriptions, setTranscriptions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getTranscriptions()
      .then(setTranscriptions)
      .catch(() => setTranscriptions(MOCK_DATA))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <Head>
        <title>Transkriptionen - Transkription WebApp</title>
      </Head>

      <h1 className="text-2xl font-bold text-gray-900 mb-6">
        Transkriptionen
      </h1>

      {loading ? (
        <LoadingSpinner />
      ) : transcriptions.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-500 text-lg">
            Noch keine Transkriptionen vorhanden.
          </p>
          <p className="text-gray-400 mt-2">
            Laden Sie eine Audio-Datei hoch, um zu beginnen.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {transcriptions.map((t) => (
            <TranscriptionCard key={t.id} transcription={t} />
          ))}
        </div>
      )}
    </>
  );
}
