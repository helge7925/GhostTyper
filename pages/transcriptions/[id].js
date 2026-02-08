import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { useState, useEffect, useMemo } from 'react';
import StatusBadge from '../../components/StatusBadge';
import LoadingSpinner from '../../components/LoadingSpinner';
import { getTranscription, deleteTranscription, updateSpeakers, startAnalysis } from '../../lib/api';
import { STATUS } from '../../lib/constants';

export default function TranscriptionDetail() {
  const router = useRouter();
  const { id } = router.query;
  const { data: session, status: authStatus } = useSession();
  const [transcription, setTranscription] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [speakerNames, setSpeakerNames] = useState({});
  const [savingSpeakers, setSavingSpeakers] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.push('/login');
      return;
    }
    if (!id || authStatus !== 'authenticated') return;

    getTranscription(id)
      .then((data) => {
        setTranscription(data);
        if (data.speakers) setSpeakerNames(data.speakers);
      })
      .catch(() => setTranscription(null))
      .finally(() => setLoading(false));
  }, [id, authStatus, router]);

  // Poll for updates if processing or analyzing
  useEffect(() => {
    if (!transcription) return;
    const pollingStatuses = [STATUS.PROCESSING, STATUS.ANALYZING];
    if (!pollingStatuses.includes(transcription.status)) return;

    const interval = setInterval(async () => {
      try {
        const updated = await getTranscription(id);
        setTranscription(updated);
        if (updated.speakers) setSpeakerNames(updated.speakers);
        if (!pollingStatuses.includes(updated.status)) {
          clearInterval(interval);
        }
      } catch {}
    }, 5000);

    return () => clearInterval(interval);
  }, [transcription?.status, id]);

  // Extract unique speaker IDs from segments
  const speakerIds = useMemo(() => {
    if (!transcription?.segments) return [];
    const ids = new Set(transcription.segments.map(s => s.speaker_id).filter(Boolean));
    return [...ids];
  }, [transcription?.segments]);

  async function handleDelete() {
    if (!confirm('Transkription wirklich löschen?')) return;
    setDeleting(true);
    try {
      await deleteTranscription(id);
      router.push('/transcriptions');
    } catch {
      setDeleting(false);
    }
  }

  async function handleSaveSpeakers() {
    setSavingSpeakers(true);
    try {
      await updateSpeakers(id, speakerNames);
    } catch {
      // handled silently
    } finally {
      setSavingSpeakers(false);
    }
  }

  async function handleStartAnalysis() {
    setAnalyzing(true);
    try {
      await updateSpeakers(id, speakerNames);
      await startAnalysis(id);
      setTranscription((prev) => ({ ...prev, status: STATUS.ANALYZING }));
    } catch {
      setAnalyzing(false);
    }
  }

  if (authStatus === 'loading' || loading) return <LoadingSpinner />;

  if (!transcription) {
    return (
      <div className="bg-dark-card border border-white/[0.06] rounded-xl p-12 text-center">
        <p className="text-text-primary font-medium mb-2">Transkription nicht gefunden</p>
        <Link href="/transcriptions" className="text-accent-purple text-sm font-medium hover:underline">
          Zurück zur Übersicht
        </Link>
      </div>
    );
  }

  const analysis = transcription.analysis;

  return (
    <>
      <Head>
        <title>{transcription.original_name} - GhostTyper</title>
      </Head>

      <Link href="/transcriptions" className="text-accent-purple text-sm font-medium hover:underline inline-flex items-center gap-1 mb-6">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Zurück
      </Link>

      <div className="bg-dark-card border border-white/[0.06] rounded-xl p-6 mb-4">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-xl font-semibold text-text-primary">
              {transcription.original_name}
            </h1>
            <p className="text-sm text-text-secondary mt-1">
              {new Date(transcription.created_at).toLocaleDateString('de-DE', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
              {transcription.template && (
                <span className="ml-2 text-text-secondary/60">
                  Template: {transcription.template}
                </span>
              )}
              {transcription.diarize && (
                <span className="ml-2 text-text-secondary/60">
                  Sprechererkennung
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={transcription.status} />
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="text-sm text-text-secondary hover:text-accent-red transition-colors"
            >
              Löschen
            </button>
          </div>
        </div>

        {transcription.status === STATUS.PROCESSING && (
          <div className="flex items-center gap-3 bg-accent-purple/10 rounded-lg p-4 text-sm text-accent-purple">
            <div className="w-5 h-5 border-2 border-accent-purple border-t-transparent rounded-full animate-spin" />
            Transkription wird verarbeitet...
          </div>
        )}

        {transcription.status === STATUS.ANALYZING && (
          <div className="flex items-center gap-3 bg-accent-purple/10 rounded-lg p-4 text-sm text-accent-purple">
            <div className="w-5 h-5 border-2 border-accent-purple border-t-transparent rounded-full animate-spin" />
            Analyse läuft...
          </div>
        )}

        {transcription.status === STATUS.ERROR && (
          <div className="bg-accent-red/10 rounded-lg p-4 text-sm text-accent-red">
            Fehler: {transcription.error || 'Unbekannter Fehler'}
          </div>
        )}
      </div>

      {/* Speaker assignment UI — shown when status is 'transcribed' */}
      {transcription.status === STATUS.TRANSCRIBED && speakerIds.length > 0 && (
        <div className="bg-dark-card border border-white/[0.06] rounded-xl p-6 mb-4">
          <h2 className="text-base font-medium text-text-primary mb-1">Sprecher zuweisen</h2>
          <p className="text-sm text-text-secondary mb-4">
            Weisen Sie den erkannten Sprechern Namen zu, bevor die Analyse gestartet wird.
          </p>

          <div className="space-y-3 mb-5">
            {speakerIds.map((speakerId) => (
              <div key={speakerId} className="flex items-center gap-3">
                <span className="text-sm text-text-secondary w-24 flex-shrink-0">{speakerId}</span>
                <input
                  type="text"
                  value={speakerNames[speakerId] || ''}
                  onChange={(e) =>
                    setSpeakerNames((prev) => ({ ...prev, [speakerId]: e.target.value }))
                  }
                  placeholder="Name eingeben"
                  className="flex-1 bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-secondary focus:ring-2 focus:ring-accent-purple focus:border-accent-purple outline-none"
                />
              </div>
            ))}
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleSaveSpeakers}
              disabled={savingSpeakers}
              className="border border-white/[0.12] text-text-secondary px-5 py-2 rounded-full text-sm font-medium hover:bg-white/[0.06] transition-colors disabled:opacity-50"
            >
              {savingSpeakers ? 'Wird gespeichert...' : 'Namen speichern'}
            </button>
            <button
              onClick={handleStartAnalysis}
              disabled={analyzing}
              className="gradient-accent text-white px-5 py-2 rounded-full text-sm font-medium transition-colors disabled:opacity-50"
            >
              {analyzing ? 'Analyse startet...' : 'Analyse starten'}
            </button>
          </div>
        </div>
      )}

      {transcription.text && (
        <div className="bg-dark-card border border-white/[0.06] rounded-xl p-6 mb-4">
          <h2 className="text-base font-medium text-text-primary mb-3">Transkription</h2>
          <div className="whitespace-pre-wrap text-sm text-text-secondary leading-relaxed">
            {transcription.text}
          </div>
        </div>
      )}

      {analysis && typeof analysis === 'object' && (
        <div className="bg-dark-card border border-white/[0.06] rounded-xl p-6">
          <h2 className="text-base font-medium text-text-primary mb-3">Analyse</h2>

          {analysis.zusammenfassung && (
            <div className="mb-4">
              <h3 className="text-sm font-medium text-text-secondary mb-1">Zusammenfassung</h3>
              <p className="text-sm text-text-secondary/80">{analysis.zusammenfassung}</p>
            </div>
          )}

          {analysis.todos && analysis.todos.length > 0 && (
            <div className="mb-4">
              <h3 className="text-sm font-medium text-text-secondary mb-2">To-Dos</h3>
              <div className="space-y-2">
                {analysis.todos.map((todo, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <span className={`inline-block mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${
                      todo.prioritaet === 'hoch' ? 'bg-accent-red' :
                      todo.prioritaet === 'mittel' ? 'bg-accent-yellow' : 'bg-accent-green'
                    }`} />
                    <div>
                      <span className="text-text-primary">{todo.aufgabe}</span>
                      {todo.verantwortlich && todo.verantwortlich !== 'unbekannt' && (
                        <span className="text-text-secondary ml-1">({todo.verantwortlich})</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {analysis.entscheidungen && analysis.entscheidungen.length > 0 && (
            <div className="mb-4">
              <h3 className="text-sm font-medium text-text-secondary mb-2">Entscheidungen</h3>
              <ul className="list-disc list-inside text-sm text-text-secondary/80 space-y-1">
                {analysis.entscheidungen.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}

          {analysis.raeume && analysis.raeume.length > 0 && (
            <div className="mb-4">
              <h3 className="text-sm font-medium text-text-secondary mb-2">Räume</h3>
              {analysis.raeume.map((raum, i) => (
                <div key={i} className="mb-3">
                  <p className="text-sm font-medium text-text-primary">{raum.name}</p>
                  {raum.elemente?.map((el, j) => (
                    <p key={j} className="text-sm text-text-secondary ml-4">
                      {el.typ}: {el.masse?.breite}x{el.masse?.hoehe}m
                      {el.anzahl > 1 && ` (${el.anzahl}x)`}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          )}

          {analysis.warnungen && analysis.warnungen.length > 0 && (
            <div className="bg-accent-yellow/10 rounded-lg p-3">
              <h3 className="text-sm font-medium text-accent-yellow mb-1">Warnungen</h3>
              <ul className="text-sm text-accent-yellow/80 space-y-1">
                {analysis.warnungen.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}

          {analysis.raw && (
            <pre className="text-sm text-text-secondary whitespace-pre-wrap">{analysis.raw}</pre>
          )}
        </div>
      )}
    </>
  );
}
