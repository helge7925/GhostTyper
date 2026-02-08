import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { useState, useEffect } from 'react';
import TranscriptionCard from '../components/TranscriptionCard';
import LoadingSpinner from '../components/LoadingSpinner';
import { getTranscriptions } from '../lib/api';

export default function Transcriptions() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [transcriptions, setTranscriptions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
      return;
    }
    if (status !== 'authenticated') return;

    getTranscriptions()
      .then(setTranscriptions)
      .catch(() => setTranscriptions([]))
      .finally(() => setLoading(false));
  }, [status, router]);

  if (status === 'loading' || (status === 'unauthenticated')) return null;

  return (
    <>
      <Head>
        <title>Historie - GhostTyper</title>
      </Head>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-text-primary">
          Historie
        </h1>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : transcriptions.length === 0 ? (
        <div className="bg-dark-card border border-white/[0.06] rounded-xl p-12 text-center">
          <div className="w-16 h-16 bg-white/[0.06] rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <p className="text-text-primary font-medium mb-1">
            Noch keine Transkriptionen
          </p>
          <p className="text-sm text-text-secondary mb-4">
            Laden Sie eine Audiodatei hoch, um zu beginnen.
          </p>
          <Link
            href="/upload"
            className="inline-block gradient-accent text-white px-5 py-2 rounded-full text-sm font-medium transition-colors"
          >
            Audio hochladen
          </Link>
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
