import Head from 'next/head';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { useState } from 'react';
import AudioUploadForm from '../components/AudioUploadForm';

export default function Upload() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [result, setResult] = useState(null);

  if (status === 'loading') return null;
  if (!session) {
    router.push('/login');
    return null;
  }

  async function handleSuccess(uploadResult) {
    setResult(uploadResult);

    // Trigger transcription processing
    try {
      await fetch(`/api/transcriptions/${uploadResult.id}/process`, {
        method: 'POST',
      });
    } catch {
      // Processing started in background
    }
  }

  return (
    <>
      <Head>
        <title>Hochladen - GhostTyper</title>
      </Head>

      <div className="max-w-xl mx-auto">
        <h1 className="text-2xl font-semibold text-text-primary mb-2">
          Audio hochladen
        </h1>
        <p className="text-sm text-text-secondary mb-6">
          Laden Sie eine Audiodatei hoch. Die Transkription und Analyse startet automatisch.
        </p>

        {result ? (
          <div className="bg-dark-card border border-white/[0.06] rounded-xl p-6 text-center">
            <div className="w-12 h-12 bg-accent-green/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-accent-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-lg font-medium text-text-primary mb-1">Hochgeladen</h2>
            <p className="text-sm text-text-secondary mb-4">
              {result.original_name} wird jetzt transkribiert.
              {result.diarize && ' Nach der Transkription können Sie Sprechernamen zuweisen.'}
              {!result.diarize && !result.auto_analyze && ' Sie können die Analyse später manuell starten.'}
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => router.push(`/transcriptions/${result.id}`)}
                className="gradient-accent text-white px-5 py-2 rounded-full text-sm font-medium transition-colors"
              >
                Zur Transkription
              </button>
              <button
                onClick={() => setResult(null)}
                className="border border-white/[0.12] text-text-secondary px-5 py-2 rounded-full text-sm font-medium hover:bg-white/[0.06] transition-colors"
              >
                Weitere hochladen
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-dark-card border border-white/[0.06] rounded-xl p-6">
            <AudioUploadForm onSuccess={handleSuccess} />
          </div>
        )}
      </div>
    </>
  );
}
