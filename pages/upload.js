import Head from 'next/head';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { useEffect, useRef, useState } from 'react';
import AudioUploadForm from '../components/AudioUploadForm';
import ProcessStatusCard from '../components/ProcessStatusCard';
import { STATUS } from '../lib/constants';

const TRANSCRIPTION_LOADING_MESSAGES = [
  'Wir horchen konzentriert rein und fangen jedes Wort ein.',
  'Der Audio-Turbo läuft warm. Bitte kurz nicht blinzeln.',
  'Mikro-Bits werden in gut lesbaren Text verwandelt.',
  'Unser Transkriptionskobold sortiert gerade Silben nach Schönheit.',
  'Worte werden eingesammelt wie Münzen in einem Jump-and-Run.',
  'Kurz den Ton durchkämmen, dann steht der Text geschniegelt da.',
  'Das Mikrofon erzählt, wir tippen mit Überschall mit.',
  'Jede Pause wird respektiert, jedes Wort sauber geparkt.',
  'Unsere Audio-Sheriffs bringen gerade Ordnung in den Klangsaloon.',
  'Tonspur im Wellnessprogramm: danach kommt sie als Text zurück.',
  'Der Satzbau liegt schon bereit und wartet auf neue Wörter.',
  'Wir bauen aus Wellen gerade lesbare Sätze aus Beton.',
];

const ANALYSIS_LOADING_MESSAGES = [
  'Die KI sortiert gerade Gedankenchaos in Chef-freundliche Bulletpoints.',
  'Virtuelle Textwichtel streichen Füllwörter und polieren Aussagen.',
  'Kaffeemaschine für die KI ist an. Zusammenfassung brüht bereits.',
  'Absätze bekommen gerade Struktur, Haltung und einen sauberen Scheitel.',
  'Unser KI-Lektor jongliert gerade Kernaussagen und To-dos.',
  'Die wichtigsten Punkte werden gerade elegant in Reihen aufgestellt.',
  'Aus losem Redefluss wird gerade eine präzise Landkarte.',
  'Wir fangen Aufgaben ein, bevor sie sich als „später“ tarnen.',
  'Gedanken werden gebündelt und auf Kurzkurs gebracht.',
  'Der Prioritäten-Detektor blinkt. Wichtiges wird markiert.',
  'Klarheit wird gerade in handliche Portionen geschnitten.',
  'Die KI zieht gerade einen roten Faden durch den Text.',
];

export default function Upload() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [result, setResult] = useState(null);
  const [liveStatus, setLiveStatus] = useState(null);
  const [statusStartedAt, setStatusStartedAt] = useState(null);
  const [autoOpenWhenReady, setAutoOpenWhenReady] = useState(true);
  const [autoOpenEditorWhenReady, setAutoOpenEditorWhenReady] = useState(true);
  const [hasAutoRedirected, setHasAutoRedirected] = useState(false);
  const [startError, setStartError] = useState('');
  const [startingProcess, setStartingProcess] = useState(false);
  const redirectStateRef = useRef({ hasAutoRedirected: false });

  useEffect(() => {
    redirectStateRef.current = { hasAutoRedirected };
  }, [hasAutoRedirected]);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  async function triggerProcessingStart(transcriptionId) {
    setStartingProcess(true);
    setStartError('');
    try {
      const res = await fetch(`/api/transcriptions/${transcriptionId}/process`, {
        method: 'POST',
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStartError(payload?.message || 'Verarbeitung konnte nicht gestartet werden.');
        return false;
      }
      if (payload?.status) {
        setLiveStatus(payload.status);
      } else {
        setLiveStatus(STATUS.PROCESSING);
      }
      setStatusStartedAt(new Date().toISOString());
      return true;
    } catch {
      setStartError('Verarbeitung konnte nicht gestartet werden. Bitte erneut versuchen.');
      return false;
    } finally {
      setStartingProcess(false);
    }
  }

  async function handleSuccess(uploadResult) {
    setResult(uploadResult);
    setLiveStatus(STATUS.PENDING);
    setStatusStartedAt(uploadResult.created_at || new Date().toISOString());
    setAutoOpenEditorWhenReady(true);
    redirectStateRef.current = { hasAutoRedirected: false };
    setHasAutoRedirected(false);
    setStartError('');

    // Trigger transcription processing.
    await triggerProcessingStart(uploadResult.id);
  }

  useEffect(() => {
    if (!result?.id) return undefined;
    const supportsEditorAutoOpen = Boolean(result.auto_analyze && !result.diarize);

    let eventSource = null;
    let fallbackInterval = null;

    const handleSnapshot = (data) => {
      setLiveStatus((prev) => {
        if (prev !== data.status) {
          setStatusStartedAt(data.updated_at || new Date().toISOString());
        }
        return data.status;
      });

      if (
        !redirectStateRef.current.hasAutoRedirected &&
        autoOpenWhenReady &&
        (data.status === STATUS.TRANSCRIBED || data.status === STATUS.COMPLETED)
      ) {
        redirectStateRef.current = { hasAutoRedirected: true };
        setHasAutoRedirected(true);
        if (supportsEditorAutoOpen && autoOpenEditorWhenReady && data.status === STATUS.COMPLETED) {
          router.push(`/transcriptions/${result.id}?autoEditor=1`);
        } else {
          router.push(`/transcriptions/${result.id}`);
        }
      }
    };

    const startFallbackPolling = () => {
      if (fallbackInterval) return;
      fallbackInterval = setInterval(async () => {
        try {
          const res = await fetch(`/api/transcriptions/${result.id}`);
          if (!res.ok) return;
          const data = await res.json();
          handleSnapshot(data);
        } catch {
          // Ignore transient fallback errors.
        }
      }, 3000);
    };

    if (typeof window !== 'undefined' && 'EventSource' in window) {
      eventSource = new EventSource(`/api/transcriptions/${result.id}/stream`);

      eventSource.addEventListener('transcription', (event) => {
        try {
          handleSnapshot(JSON.parse(event.data));
        } catch {
          // Ignore malformed packets.
        }
      });

      eventSource.addEventListener('missing', () => {
        eventSource?.close();
      });

      eventSource.onerror = () => {
        eventSource?.close();
        startFallbackPolling();
      };
    } else {
      startFallbackPolling();
    }

    return () => {
      if (eventSource) {
        eventSource.close();
      }
      if (fallbackInterval) {
        clearInterval(fallbackInterval);
      }
    };
  }, [result?.id, result?.auto_analyze, result?.diarize, autoOpenWhenReady, autoOpenEditorWhenReady, router]);

  if (status === 'loading' || !session) return null;

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
          Laden Sie eine Audiodatei hoch. Die Transkription startet automatisch.
        </p>

        {result ? (
          <div className="bg-dark-card border border-white/[0.06] rounded-xl p-6 text-center">
            <div className="mb-5">
              <ProcessStatusCard
                title={
                  liveStatus === STATUS.COMPLETED || liveStatus === STATUS.TRANSCRIBED
                    ? 'Verarbeitung abgeschlossen'
                    : liveStatus === STATUS.ANALYZING
                      ? 'Auswertung läuft'
                      : 'Transkription läuft'
                }
                description={
                  liveStatus === STATUS.COMPLETED || liveStatus === STATUS.TRANSCRIBED
                    ? 'Das Ergebnis ist bereit und kann geöffnet werden.'
                  : liveStatus === STATUS.ANALYZING
                      ? 'Der transkribierte Text wird ausgewertet.'
                      : `${result.original_name} wird verarbeitet.`
                }
                steps={
                  result.auto_analyze && !result.diarize
                    ? [
                      { key: 'transcription', label: 'Audio transkribieren' },
                      { key: 'analysis', label: 'Zusammenfassung erstellen' },
                    ]
                    : [
                      { key: 'transcription', label: 'Audio transkribieren' },
                    ]
                }
                activeStep={liveStatus === STATUS.ANALYZING ? 1 : 0}
                done={liveStatus === STATUS.COMPLETED || liveStatus === STATUS.TRANSCRIBED}
                startedAt={statusStartedAt}
                etaSeconds={liveStatus === STATUS.ANALYZING ? 22 : 45}
                messages={
                  liveStatus === STATUS.ANALYZING
                    ? ANALYSIS_LOADING_MESSAGES
                    : TRANSCRIPTION_LOADING_MESSAGES
                }
              />
            </div>

            <div className="flex gap-3 justify-center">
              <button
                onClick={() => router.push(`/transcriptions/${result.id}`)}
                className="gradient-accent text-white px-5 py-2 rounded-full text-sm font-medium transition-colors"
              >
                Status öffnen
              </button>
              {startError && (
                <button
                  onClick={() => triggerProcessingStart(result.id)}
                  disabled={startingProcess}
                  className="bg-white/10 hover:bg-white/15 text-text-primary px-5 py-2 rounded-full text-sm font-medium border border-white/10 disabled:opacity-50"
                >
                  {startingProcess ? 'Startet…' : 'Erneut starten'}
                </button>
              )}
            </div>

            {startError && (
              <div className="mt-4 text-left bg-accent-red/10 border border-accent-red/30 text-accent-red rounded-xl px-4 py-3 text-xs">
                {startError}
              </div>
            )}

            <label className="mt-4 flex items-center justify-center gap-2 text-xs text-text-secondary">
              <input
                type="checkbox"
                checked={autoOpenWhenReady}
                onChange={(e) => setAutoOpenWhenReady(e.target.checked)}
                className="w-4 h-4 rounded border-white/20 bg-dark-input text-accent-orange focus:ring-accent-orange"
              />
              Detailseite automatisch öffnen, sobald das Ergebnis bereit ist
            </label>

            {result.auto_analyze && !result.diarize && (
              <label className="mt-2 flex items-center justify-center gap-2 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  checked={autoOpenEditorWhenReady}
                  onChange={(e) => setAutoOpenEditorWhenReady(e.target.checked)}
                  className="w-4 h-4 rounded border-white/20 bg-dark-input text-accent-orange focus:ring-accent-orange"
                />
                Editor nach Zusammenfassung automatisch öffnen
              </label>
            )}
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
