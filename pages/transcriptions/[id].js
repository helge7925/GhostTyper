import Head from 'next/head';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import StatusBadge from '../../components/StatusBadge';
import LoadingSpinner from '../../components/LoadingSpinner';
import Toast from '../../components/Toast';
import DocumentEditor from '../../components/DocumentEditor';
import ProcessStatusCard from '../../components/ProcessStatusCard';
import { getTranscription, deleteTranscription, updateSpeakers, startAnalysis } from '../../lib/api';
import { STATUS } from '../../lib/constants';
import { analysisToHtml } from '../../lib/export-utils';

const TRANSCRIPTION_LOADING_MESSAGES = [
  'Wir lauschen tief konzentriert und schreiben fleißig mit.',
  'Der Audio-Decoder trinkt gerade einen Espresso und legt los.',
  'Wörter werden aus dem Klang gefischt und sauber abgelegt.',
  'Unser Notizgeist schreibt schneller als jeder Stenograf.',
  'Das Audio wird gerade in Klartext verwandelt - Buchstabe für Buchstabe.',
  'Kurzer Moment: Wir entwirren gerade alle Satzfäden.',
  'Wir parken jedes Wort sauber in der richtigen Zeile.',
  'Die Tonspur wird gerade textlich auf Hochglanz poliert.',
  'Ein kleines Team aus Bits macht gerade große Notizen.',
  'Wir geben jedem Halbsatz ein liebevolles Zuhause.',
  'Audio rein, Klartext raus - läuft.',
  'Wir sortieren gerade Klang in klare Aussagen.',
];

const ANALYSIS_LOADING_MESSAGES = [
  'Die KI macht aus Rohtext gerade ein Ergebnis mit Hand und Fuß.',
  'Gedanken werden sortiert. Prioritäten bekommen gerade Helme und Warnwesten.',
  'Virtueller Redakteur aktiv: kürzt, bündelt und strukturiert.',
  'To-dos werden eingefangen, bevor sie wieder weglaufen.',
  'Unser Struktur-Bot verteilt gerade Überschriften und Klarheit.',
  'Feinschliff läuft: aus viel Text wird kompakte Übersicht.',
  'Wir ziehen gerade den roten Faden straff und ordentlich.',
  'Kernaussagen werden markiert, geglättet und in Reih und Glied gestellt.',
  'Der KI-Lektor setzt gerade semantische Leitplanken.',
  'Mehr Überblick in Arbeit: wichtige Punkte kommen nach vorne.',
  'Das Ergebnis bekommt gerade ein aufgeräumtes Layout im Kopf.',
  'Wir verwandeln gerade Gesprächswolken in klare Checklisten.',
];

const EVENT_STAGE_LABELS = {
  queued: 'Warteschlange',
  processing: 'Transkription',
  speaker_assignment: 'Sprecher',
  analyzing: 'KI-Analyse',
  completed: 'Fertig',
  error: 'Fehler',
};

function eventDotClass(stage) {
  if (stage === 'completed') return 'bg-accent-green';
  if (stage === 'error') return 'bg-accent-red';
  if (stage === 'analyzing') return 'bg-accent-orange';
  if (stage === 'speaker_assignment') return 'bg-accent-cyan';
  return 'bg-accent-yellow';
}

/**
 * Optimized Speaker Input component to prevent full page re-renders on every keystroke
 */
function SpeakerInput({ sid, value, onChange }) {
  const [localValue, setLocalValue] = useState(value);
  
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  return (
    <input 
      type="text" 
      value={localValue || ''} 
      onChange={e => setLocalValue(e.target.value)}
      onBlur={() => onChange(sid, localValue)}
      placeholder={sid} 
      className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-1.5 text-xs text-text-primary outline-none focus:ring-1 focus:ring-accent-orange" 
    />
  );
}

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
  const [toast, setToast] = useState(null);
  const [startingProcessing, setStartingProcessing] = useState(false);
  const [processingStartError, setProcessingStartError] = useState('');
  const statusRef = useRef(null);

  // Editor state
  const [showEditor, setShowEditor] = useState(false);
  const [editorHtml, setEditorHtml] = useState('');

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
        if (data.document_html) setEditorHtml(data.document_html);
      })
      .catch(() => setTranscription(null))
      .finally(() => setLoading(false));
  }, [id, authStatus, router]);

  useEffect(() => {
    if (!router.isReady || showEditor || !transcription) return;

    const shouldAutoOpenEditor = router.query.autoEditor === '1';
    const canOpenEditor = transcription.status === STATUS.COMPLETED && Boolean(transcription.analysis);
    if (!shouldAutoOpenEditor || !canOpenEditor) return;

    setShowEditor(true);
    router.replace(`/transcriptions/${id}`, undefined, { shallow: true });
  }, [router, id, showEditor, transcription]);

  useEffect(() => {
    statusRef.current = transcription?.status || null;
  }, [transcription?.status]);

  // Live updates via SSE with polling fallback.
  useEffect(() => {
    if (!transcription) return;
    const trackedStatuses = [STATUS.PENDING, STATUS.PROCESSING, STATUS.ANALYZING];
    if (!trackedStatuses.includes(transcription.status)) return undefined;

    let eventSource = null;
    let fallbackInterval = null;

    const handleUpdate = (updated) => {
      const previousStatus = statusRef.current;
      if (previousStatus !== updated.status) {
        if (updated.status === STATUS.TRANSCRIBED) {
          setToast({ message: 'Transkription ist fertig.', type: 'success' });
        } else if (updated.status === STATUS.ANALYZING) {
          setToast({ message: 'Transkription ist fertig. Auswertung läuft.', type: 'info' });
        } else if (updated.status === STATUS.COMPLETED) {
          setToast({ message: 'Auswertung ist fertig.', type: 'success' });
        }
      }

      statusRef.current = updated.status;
      setTranscription(updated);
      if (updated.document_html) setEditorHtml(updated.document_html);
    };

    const startFallbackPolling = () => {
      if (fallbackInterval) return;
      fallbackInterval = setInterval(async () => {
        try {
          const updated = await getTranscription(id);
          handleUpdate(updated);
        } catch {
          // Ignore temporary fallback errors.
        }
      }, 3000);
    };

    if (typeof window !== 'undefined' && 'EventSource' in window) {
      eventSource = new EventSource(`/api/transcriptions/${id}/stream`);

      eventSource.addEventListener('transcription', (event) => {
        try {
          handleUpdate(JSON.parse(event.data));
        } catch {
          // Ignore malformed stream packets.
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
  }, [transcription?.status, id]);

  const speakerIds = useMemo(() => {
    if (!transcription?.segments) return [];
    return [...new Set(transcription.segments.map(s => s.speaker_id).filter(Boolean))];
  }, [transcription?.segments]);

  const handleStartAnalysis = useCallback(async () => {
    setAnalyzing(true);
    try {
      await updateSpeakers(id, speakerNames);
      await startAnalysis(id);
      setTranscription(prev => ({ ...prev, status: STATUS.ANALYZING }));
    } catch {
      setAnalyzing(false);
    }
  }, [id, speakerNames]);

  const handleStartProcessing = useCallback(async () => {
    setStartingProcessing(true);
    setProcessingStartError('');
    try {
      const res = await fetch(`/api/transcriptions/${id}/process`, { method: 'POST' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setProcessingStartError(payload?.message || 'Verarbeitung konnte nicht gestartet werden.');
        return;
      }
      const nextStatus = payload?.status || STATUS.PROCESSING;
      const toastMessage =
        nextStatus === STATUS.PROCESSING || nextStatus === STATUS.ANALYZING
          ? 'Verarbeitung läuft.'
          : 'Verarbeitung ist bereits abgeschlossen.';
      setToast({ message: toastMessage, type: 'success' });
      setTranscription((prev) => prev ? { ...prev, status: nextStatus, updated_at: new Date().toISOString() } : prev);
    } catch {
      setProcessingStartError('Verarbeitung konnte nicht gestartet werden.');
    } finally {
      setStartingProcessing(false);
    }
  }, [id]);

  const handleSaveDocument = useCallback(async (html) => {
    setEditorHtml(html);
    try {
      await fetch(`/api/transcriptions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentHtml: html }),
      });
      setToast({ message: 'Dokument gespeichert.', type: 'success' });
    } catch {
      setToast({ message: 'Fehler beim Speichern.', type: 'error' });
    }
  }, [id]);

  const handleSpeakerChange = useCallback((sid, name) => {
    setSpeakerNames(prev => ({ ...prev, [sid]: name }));
  }, []);

  const transcriptionHtml = useMemo(() => {
    if (!transcription) return '';
    return editorHtml || analysisToHtml(transcription);
  }, [transcription, editorHtml]);

  const workflowState = useMemo(() => {
    if (!transcription) return null;

    const hasAutoAnalysis = transcription.auto_analyze !== false;
    const needsSpeakerAssignment = Boolean(transcription.diarize);

    const steps = [{ key: 'transcription', label: 'Audio wird transkribiert' }];
    if (needsSpeakerAssignment) {
      steps.push({ key: 'speakers', label: 'Sprecher prüfen und zuweisen' });
    }
    if (hasAutoAnalysis) {
      steps.push({ key: 'analysis', label: 'KI erstellt Zusammenfassung' });
    }

    let activeStep = 0;
    let done = false;
    let title = 'Transkription wird vorbereitet';
    let description = 'Upload abgeschlossen. Die Verarbeitung startet im Hintergrund.';

    if (transcription.status === STATUS.PROCESSING) {
      activeStep = 0;
      title = 'Transkription läuft';
      description = 'Das Audio wird gerade in Text umgewandelt.';
    } else if (transcription.status === STATUS.PENDING) {
      activeStep = 0;
      title = 'Wartet auf Verarbeitung';
      description = 'Der Auftrag wurde gespeichert und wird gleich gestartet.';
    } else if (transcription.status === STATUS.TRANSCRIBED) {
      if (needsSpeakerAssignment) {
        activeStep = 1;
        title = 'Transkription ist fertig';
        description = 'Bitte Sprecher prüfen. Danach kann die Analyse gestartet werden.';
      } else {
        done = !hasAutoAnalysis;
        activeStep = hasAutoAnalysis ? Math.max(steps.length - 1, 0) : steps.length;
        title = hasAutoAnalysis ? 'Transkription ist fertig' : 'Transkription abgeschlossen';
        description = hasAutoAnalysis
          ? 'Die Analyse wurde noch nicht gestartet.'
          : 'Sie können das Ergebnis jetzt im Editor öffnen.';
      }
    } else if (transcription.status === STATUS.ANALYZING) {
      activeStep = Math.max(steps.length - 1, 1);
      title = 'KI-Analyse läuft';
      description = 'Der transkribierte Text wird jetzt zusammengefasst und strukturiert.';
    } else if (transcription.status === STATUS.COMPLETED) {
      done = true;
      activeStep = steps.length;
      title = 'Verarbeitung abgeschlossen';
      description = 'Transkription und Analyse sind verfügbar.';
    }

    return { title, description, steps, activeStep, done };
  }, [transcription]);

  const workflowMessages = useMemo(() => {
    if (!transcription) return [];

    if (transcription.status === STATUS.ANALYZING) {
      return ANALYSIS_LOADING_MESSAGES;
    }

    if (transcription.status === STATUS.PROCESSING || transcription.status === STATUS.PENDING) {
      return TRANSCRIPTION_LOADING_MESSAGES;
    }

    return [];
  }, [transcription]);

  if (authStatus === 'loading' || loading) return <LoadingSpinner />;
  if (!transcription) return null;

  const isOCR = transcription.mime_type?.startsWith('image/') || transcription.mime_type === 'application/pdf';
  const typeLabel = isOCR ? 'Dokument' : 'Transkription';
  const rawTextLabel = isOCR ? 'Extrahierter Text' : 'Transkription';
  const timelineEvents = Array.isArray(transcription.events) ? transcription.events : [];

  return (
    <>
      <Head><title>{transcription.original_name} - GhostTyper</title></Head>

      {!showEditor ? (
        <div className="max-w-5xl mx-auto animate-fade-in pb-20">
          <button onClick={() => router.push('/transcriptions')} className="text-text-secondary hover:text-text-primary text-xs flex items-center gap-1 mb-6">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></svg>
            Zurück zur Historie
          </button>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: Info & Actions */}
            <div className="lg:col-span-1 space-y-6">
              <div className="bg-dark-card border border-white/[0.06] rounded-2xl p-6 shadow-xl">
                <StatusBadge status={transcription.status} />
                <h1 className="text-lg font-semibold text-text-primary mt-3 truncate">{transcription.original_name}</h1>
                <p className="text-[10px] text-text-secondary uppercase tracking-widest mt-1">
                  {new Date(transcription.created_at).toLocaleDateString('de-DE')} &bull; {typeLabel}
                </p>
                
                {/* Context & Settings */}
                <div className="mt-6 pt-6 border-t border-white/[0.06] space-y-4">
                  <div>
                    <label className="text-[10px] font-bold text-text-secondary uppercase opacity-50">Analyse-Modus</label>
                    <p className="text-sm text-text-primary capitalize">{transcription.template === 'generic' ? 'Zusammenfassung' : transcription.template}</p>
                  </div>
                  {transcription.custom_prompt && (
                    <div>
                      <label className="text-[10px] font-bold text-text-secondary uppercase opacity-50">Anweisung</label>
                      <p className="text-xs text-text-secondary italic">"{transcription.custom_prompt}"</p>
                    </div>
                  )}
                </div>

                <div className="mt-8 flex flex-col gap-2">
                  {transcription.status === STATUS.PENDING && (
                    <button
                      onClick={handleStartProcessing}
                      disabled={startingProcessing}
                      className="bg-white/5 hover:bg-white/10 text-text-primary py-2 rounded-xl text-sm font-bold border border-white/[0.06] transition-all disabled:opacity-50"
                    >
                      {startingProcessing ? 'Startet…' : 'Verarbeitung starten'}
                    </button>
                  )}
                  <button 
                    onClick={() => {
                      setShowEditor(true);
                    }}
                    disabled={!transcription.text && !transcription.analysis}
                    className="gradient-accent text-white py-2 rounded-xl text-sm font-bold shadow-lg shadow-accent-orange/20 transition-all hover:scale-[1.02] active:scale-100 disabled:opacity-30"
                  >
                    Im Editor öffnen
                  </button>
                  <button onClick={() => { if(confirm(`${typeLabel} wirklich löschen?`)) deleteTranscription(id).then(() => router.push('/transcriptions')) }} className="text-text-secondary hover:text-accent-red py-2 text-xs transition-colors">
                    {typeLabel} löschen
                  </button>
                </div>
                {processingStartError && (
                  <div className="mt-3 bg-accent-red/10 border border-accent-red/25 text-accent-red rounded-xl p-3 text-xs">
                    {processingStartError}
                  </div>
                )}
              </div>

              {/* Speaker Assignment */}
              {transcription.status === STATUS.TRANSCRIBED && speakerIds.length > 0 && !isOCR && (
                <div className="bg-dark-card border border-white/[0.06] rounded-2xl p-6 shadow-xl">
                  <h3 className="text-xs font-bold text-text-primary uppercase mb-4">Sprecher</h3>
                  <div className="space-y-3">
                    {speakerIds.map(sid => (
                      <SpeakerInput 
                        key={sid} 
                        sid={sid} 
                        value={speakerNames[sid]} 
                        onChange={handleSpeakerChange} 
                      />
                    ))}
                  </div>
                  <button onClick={handleStartAnalysis} disabled={analyzing} className="w-full mt-4 bg-white/5 hover:bg-white/10 text-text-primary py-2 rounded-xl text-xs font-bold border border-white/[0.06] transition-all">
                    {analyzing ? 'Analyse läuft...' : 'Analyse starten'}
                  </button>
                </div>
              )}
            </div>

            {/* Right: Preview Area */}
            <div className="lg:col-span-2 space-y-6">
              {workflowState && [STATUS.PENDING, STATUS.PROCESSING, STATUS.ANALYZING].includes(transcription.status) && (
                <ProcessStatusCard
                  title={workflowState.title}
                  description={workflowState.description}
                  steps={workflowState.steps}
                  activeStep={workflowState.activeStep}
                  done={workflowState.done}
                  startedAt={transcription.updated_at}
                  etaSeconds={transcription.status === STATUS.ANALYZING ? 20 : transcription.status === STATUS.PENDING ? 10 : 40}
                  messages={workflowMessages}
                />
              )}

              {transcription.status === STATUS.ERROR && (
                <div className="bg-accent-red/10 border border-accent-red/25 text-accent-red rounded-2xl p-4 text-sm">
                  {transcription.error || 'Verarbeitung fehlgeschlagen. Bitte erneut versuchen.'}
                </div>
              )}

              {timelineEvents.length > 0 && (
                <div className="bg-dark-card border border-white/[0.06] rounded-2xl p-5 shadow-xl">
                  <h2 className="text-xs font-bold text-text-primary uppercase tracking-widest opacity-60 mb-4">Verlauf</h2>
                  <div className="space-y-3">
                    {timelineEvents.map((event) => (
                      <div key={event.id} className="flex items-start gap-3">
                        <span className={`w-2 h-2 mt-1.5 rounded-full ${eventDotClass(event.stage)}`} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-text-primary font-medium">
                              {EVENT_STAGE_LABELS[event.stage] || event.stage}
                            </span>
                            <span className="text-[10px] text-text-secondary">
                              {new Date(event.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                          </div>
                          <p className="text-xs text-text-secondary mt-0.5">{event.message}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Analysis Preview */}
              {transcription.analysis && (
                <div className="bg-dark-card border border-accent-orange/20 rounded-2xl p-6 shadow-2xl shadow-accent-orange/5">
                  <h2 className="text-xs font-bold text-accent-orange uppercase tracking-widest mb-4">Ergebnis</h2>
                  <div className="space-y-4">
                    {transcription.analysis.zusammenfassung && (
                      <p className="text-sm text-text-primary leading-relaxed italic border-l-2 border-accent-orange/30 pl-4">{transcription.analysis.zusammenfassung}</p>
                    )}
                    <button 
                      onClick={() => {
                        setShowEditor(true);
                      }}
                      className="text-xs text-accent-orange hover:text-accent-cyan transition-colors font-bold flex items-center gap-1"
                    >
                      Vollständige Analyse im Editor bearbeiten &rarr;
                    </button>
                  </div>
                </div>
              )}

              {/* Raw Text */}
              <div className="bg-dark-card border border-white/[0.06] rounded-2xl p-6 shadow-xl">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xs font-bold text-text-primary uppercase tracking-widest opacity-50">{rawTextLabel}</h2>
                </div>
                <div className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap max-h-[400px] overflow-y-auto pr-2 custom-scrollbar font-mono opacity-80">
                  {transcription.text || (
                    transcription.status === STATUS.ANALYZING
                      ? 'Transkription abgeschlossen. Auswertung läuft...'
                      : 'Transkription läuft...'
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <DocumentEditor 
          initialHtml={transcriptionHtml}
          filename={transcription.original_name}
          sidebarContent={transcription.text}
          sourceLabel={rawTextLabel}
          onSave={handleSaveDocument}
          onCancel={() => setShowEditor(false)}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  );
}
