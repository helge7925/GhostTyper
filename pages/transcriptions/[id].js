import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import StatusBadge from '../../components/StatusBadge';
import LoadingSpinner from '../../components/LoadingSpinner';
import Toast from '../../components/Toast';
import ConfirmDialog from '../../components/ConfirmDialog';
import TableRenderer from '../../components/TableRenderer';
import ProcessStatusCard from '../../components/ProcessStatusCard';
import MeetingControlBar from '../../components/MeetingControlBar';
import TranslationCompanionPanel from '../../components/TranslationCompanionPanel';
import { getTranscription, deleteTranscription, updateSpeakers, startAnalysis } from '../../lib/api';
import { STATUS } from '../../lib/constants';
import { useMessageList, useTranslations } from '../../lib/i18n';

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

const QUEUE_LOADING_MESSAGES = [
  'Ihr Auftrag steht bereit und wird als Nächstes gestartet.',
  'Wir verteilen gerade Rechenzeit und schieben Ihren Job nach vorne.',
  'Kurz eingeplant: Die Verarbeitung startet in wenigen Augenblicken.',
  'Die Pipeline wärmt bereits die Motoren für diesen Auftrag auf.',
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
  if (stage === 'completed') return 'bg-success';
  if (stage === 'error') return 'bg-danger';
  if (stage === 'analyzing') return 'bg-accent';
  if (stage === 'speaker_assignment') return 'bg-info';
  return 'bg-warning';
}

function isDownloadableOfficeDocument(mimeType) {
  return [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ].includes(mimeType);
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
      className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-1.5 text-xs text-primary outline-none focus:ring-1 focus:ring-accent"
    />
  );
}

export default function TranscriptionDetail() {
  const router = useRouter();
  const { id } = router.query;
  const { data: session, status: authStatus } = useSession();
  const t = useTranslations('transcriptionDetailPage');
  const tCommon = useTranslations('common');
  const transcriptionMessages = useMessageList('loadingMessages.transcription');
  const [transcription, setTranscription] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [speakerNames, setSpeakerNames] = useState({});
  const [savingSpeakers, setSavingSpeakers] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisFocus, setAnalysisFocus] = useState('');
  const [toast, setToast] = useState(null);
  const [startingProcessing, setStartingProcessing] = useState(false);
  const [processingStartError, setProcessingStartError] = useState('');
  const statusRef = useRef(null);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);

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

  useEffect(() => {
    if (!router.isReady || !transcription) return;

    const shouldAutoOpenEditor = router.query.autoEditor === '1';
    const canOpenEditor = transcription.status === STATUS.COMPLETED && Boolean(transcription.analysis);
    if (!shouldAutoOpenEditor || !canOpenEditor) return;

    const isTable = transcription.analysis_type === 'table' && transcription.table_schema;
    router.replace(`/transcriptions/${id}/${isTable ? 'table' : 'edit'}`);
  }, [router, id, transcription]);

  useEffect(() => {
    statusRef.current = transcription?.status || null;
  }, [transcription?.status]);

  // Live updates via SSE with polling fallback.
  useEffect(() => {
    const currentStatus = transcription?.status;
    if (!currentStatus) return undefined;
    const trackedStatuses = [STATUS.PENDING, STATUS.QUEUED, STATUS.PROCESSING, STATUS.ANALYZING];
    if (!trackedStatuses.includes(currentStatus)) return undefined;

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
      await startAnalysis(id, { analysisFocus });
      setTranscription(prev => ({ ...prev, status: STATUS.ANALYZING }));
    } catch {
      setAnalyzing(false);
    }
  }, [id, speakerNames, analysisFocus]);

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
        nextStatus === STATUS.QUEUED || nextStatus === STATUS.PROCESSING || nextStatus === STATUS.ANALYZING
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

  const handleSpeakerChange = useCallback((sid, name) => {
    setSpeakerNames(prev => ({ ...prev, [sid]: name }));
  }, []);

  const handleDeleteTranscription = useCallback(async () => {
    setDeleting(true);
    try {
      await deleteTranscription(id);
      router.push('/transcriptions');
    } catch (err) {
      setToast({ message: err.message || 'Eintrag konnte nicht gelöscht werden.', type: 'error' });
    } finally {
      setDeleting(false);
      setConfirmDialogOpen(false);
    }
  }, [id, router]);

  // Check if this is a table analysis
  const isTableAnalysis = useMemo(() => {
    return transcription?.analysis_type === 'table' && transcription?.table_schema;
  }, [transcription]);

  const editorHref = useMemo(() => {
    if (!transcription || !id) return null;
    const sub = isTableAnalysis ? 'table' : 'edit';
    return `/transcriptions/${id}/${sub}`;
  }, [id, transcription, isTableAnalysis]);

  const tablePreviewData = useMemo(() => {
    if (!transcription) return { metadata: {}, rows: [] };
    return {
      ...(transcription.analysis || {}),
      ...(transcription.analysis_meta || {}),
    };
  }, [transcription]);

  const processState = useMemo(() => {
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

    if (transcription.status === STATUS.QUEUED) {
      activeStep = 0;
      title = 'In Warteschlange';
      description = 'Der Auftrag ist eingeplant und startet in Kürze automatisch.';
    } else if (transcription.status === STATUS.PROCESSING) {
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

  const processMessages = useMemo(() => {
    if (!transcription) return [];
    // All states share the same translated transcription pool — the
    // ProcessStatusCard's own status label already disambiguates the
    // user-facing distinction.
    return transcriptionMessages;
    // eslint-disable-next-line no-unreachable
    if (transcription.status === STATUS.ANALYZING) {
      return ANALYSIS_LOADING_MESSAGES;
    }

    if (transcription.status === STATUS.QUEUED) {
      return QUEUE_LOADING_MESSAGES;
    }

    if (transcription.status === STATUS.PROCESSING || transcription.status === STATUS.PENDING) {
      return TRANSCRIPTION_LOADING_MESSAGES;
    }

    return [];
  }, [transcription, transcriptionMessages]);

  if (authStatus === 'loading' || loading) return <LoadingSpinner />;
  if (!transcription) return <LoadingSpinner />;

  const isOCR = transcription.mime_type?.startsWith('image/') || transcription.mime_type === 'application/pdf';
  const isOfficeDocument = isDownloadableOfficeDocument(transcription.mime_type);
  const typeLabel = isOfficeDocument ? 'Datei' : isOCR ? 'Dokument' : 'Transkription';
  const rawTextLabel = isOfficeDocument ? 'Datei-Hinweis' : isOCR ? 'Extrahierter Text' : 'Transkription';
  // `aufmass` is kept here as a legacy label for pre-existing rows; it
  // is no longer offered as a new template choice in the UI.
  const TEMPLATE_DETAIL_LABELS = {
    generic: 'Zusammenfassung',
    meeting: 'Meeting',
    data_table: 'Datentabelle',
    aufmass: 'Aufmaß',
  };
  const templateLabel = TEMPLATE_DETAIL_LABELS[transcription.template] || transcription.template;
  const timelineEvents = Array.isArray(transcription.events) ? transcription.events : [];

  return (
    <>
      <Head><title>{transcription.original_name} - GhostTyper</title></Head>

      {(
        <div className="max-w-5xl mx-auto animate-fade-in pb-20">
          <button onClick={() => router.push('/transcriptions')} className="text-secondary hover:text-primary text-xs flex items-center gap-1 mb-6">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></svg>
            Zurück zur Historie
          </button>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: Info & Actions */}
            <div className="lg:col-span-1 space-y-6">
              <div className="bg-surface border border-subtle rounded-2xl p-6 shadow-xl">
                <StatusBadge status={transcription.status} />
                <h1 className="text-lg font-semibold text-primary mt-3 truncate">{transcription.original_name}</h1>
                <p className="text-[10px] text-secondary uppercase tracking-widest mt-1">
                  {new Date(transcription.created_at).toLocaleDateString('de-DE')} &bull; {typeLabel}
                </p>

                {/* Context & Settings */}
                <div className="mt-6 pt-6 border-t border-subtle space-y-4">
                  <div>
                    <label className="text-[10px] font-bold text-secondary uppercase opacity-50">Analyse-Modus</label>
                    <p className="text-sm text-primary capitalize">{templateLabel || '-'}</p>
                    {transcription.analysis_type === 'table' && (
                      <p className="text-[10px] text-accent mt-2">
                        {transcription.template === 'data_table' ? 'Datentabellen-Extraktion' : 'Tabellen-Extraktion'}
                      </p>
                    )}
                  </div>
                  {transcription.custom_prompt && (
                    <div>
                      <label className="text-[10px] font-bold text-secondary uppercase opacity-50">Anweisung</label>
                      <p className="text-xs text-secondary italic">&quot;{transcription.custom_prompt}&quot;</p>
                    </div>
                  )}
                </div>

                <div className="mt-8 flex flex-col gap-2">
                  {transcription.status === STATUS.PENDING && (
                    <button
                      onClick={handleStartProcessing}
                      disabled={startingProcessing}
                      className="bg-hover-subtle hover:bg-hover-strong text-primary py-2 rounded-xl text-sm font-bold border border-subtle transition-all disabled:opacity-50"
                    >
                      {startingProcessing ? 'Startet…' : 'Verarbeitung starten'}
                    </button>
                  )}
                  {(() => {
                    const canOpen = !isOfficeDocument && (transcription.text || transcription.analysis);
                    const className = 'gradient-accent text-white py-2 rounded-xl text-sm font-bold shadow-lg shadow-accent/20 transition-all hover:scale-[1.02] active:scale-100 text-center';
                    const label = isTableAnalysis ? 'Tabelle im Editor öffnen' : 'Im Editor öffnen';
                    if (!canOpen || !editorHref) {
                      return (
                        <button disabled className={`${className} opacity-30 cursor-not-allowed`}>
                          {label}
                        </button>
                      );
                    }
                    return (
                      <Link href={editorHref} className={className}>
                        {label}
                      </Link>
                    );
                  })()}

                  {transcription.text && (
                    <Link
                      href={`/chat?source=transcription&refId=${transcription.id}`}
                      className="bg-hover-subtle hover:bg-hover-strong text-primary py-2 rounded-xl text-sm font-bold border border-subtle text-center transition-all"
                    >
                      Mit Transkript chatten
                    </Link>
                  )}
                  {isOfficeDocument && (
                    <a
                      href={`/api/transcriptions/${transcription.id}/download`}
                      className="bg-hover-subtle hover:bg-hover-strong text-primary py-2 rounded-xl text-sm font-bold border border-subtle text-center transition-all"
                    >
                      Übersetzte Datei herunterladen
                    </a>
                  )}
                  <div className="mt-3 pt-3 border-t border-danger/20">
                    <p className="text-[10px] font-bold text-danger/70 uppercase tracking-widest mb-2">Danger Zone</p>
                    <button
                      onClick={() => setConfirmDialogOpen(true)}
                      className="w-full text-danger hover:text-red-300 bg-danger/10 border border-danger/30 py-2 rounded-xl text-xs font-semibold transition-colors disabled:opacity-50"
                      disabled={deleting}
                    >
                      {deleting ? `${typeLabel} wird gelöscht...` : `${typeLabel} löschen`}
                    </button>
                  </div>
                </div>
                {processingStartError && (
                  <div className="mt-3 bg-danger/10 border border-danger/25 text-danger rounded-xl p-3 text-xs">
                    {processingStartError}
                  </div>
                )}
              </div>

              {/* Speaker Assignment */}
              {transcription.status === STATUS.TRANSCRIBED && speakerIds.length > 0 && !isOCR && (
                <div className="bg-surface border border-subtle rounded-2xl p-6 shadow-xl">
                  <h3 className="text-xs font-bold text-primary uppercase mb-4">{t('speakerHeading')}</h3>
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
                  <div className="mt-4">
                    <label className="block text-[10px] font-bold text-secondary uppercase tracking-widest mb-1.5">
                      Fokus der Analyse
                    </label>
                    <textarea
                      value={analysisFocus}
                      onChange={(event) => setAnalysisFocus(event.target.value)}
                      rows={2}
                      placeholder="Worauf soll sich das KI-Modell bei der Analyse konzentrieren?"
                      className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-xs text-primary outline-none focus:ring-1 focus:ring-accent resize-y"
                    />
                  </div>
                  <button onClick={handleStartAnalysis} disabled={analyzing} className="w-full mt-4 bg-hover-subtle hover:bg-hover-strong text-primary py-2 rounded-xl text-xs font-bold border border-subtle transition-all">
                    {analyzing ? 'Analyse läuft...' : 'Analyse starten'}
                  </button>
                </div>
              )}
            </div>

            {/* Right: Preview Area */}
            <div className="lg:col-span-2 space-y-6">
              {transcription.source === 'vexa' && [STATUS.PENDING, STATUS.PROCESSING].includes(transcription.status) && (
                <MeetingControlBar
                  transcriptionId={transcription.id}
                  currentLanguage={transcription.language || 'de'}
                  botStatus={transcription.bot_status}
                  translationConfig={transcription.translation_config}
                  inMeetingOverlayEnabled={!!transcription.in_meeting_overlay_enabled}
                  audioInjectionLang={transcription.audio_injection_lang || null}
                  onChanged={() => getTranscription(transcription.id).then(setTranscription).catch(() => {})}
                />
              )}

              {transcription.source === 'vexa' && transcription.translation_config?.enabled && (
                <TranslationCompanionPanel transcription={transcription} />
              )}

              {processState && [STATUS.PENDING, STATUS.QUEUED, STATUS.PROCESSING, STATUS.ANALYZING].includes(transcription.status) && (
                <ProcessStatusCard
                  title={processState.title}
                  description={processState.description}
                  steps={processState.steps}
                  activeStep={processState.activeStep}
                  done={processState.done}
                  startedAt={transcription.updated_at}
                  etaSeconds={transcription.status === STATUS.ANALYZING ? 20 : transcription.status === STATUS.PENDING ? 10 : 40}
                  messages={processMessages}
                />
              )}

              {transcription.status === STATUS.ERROR && (
                <div className="bg-danger/10 border border-danger/25 text-danger rounded-2xl p-4 text-sm">
                  {transcription.error || 'Verarbeitung fehlgeschlagen. Bitte erneut versuchen.'}
                </div>
              )}

              {timelineEvents.length > 0 && (
                <div className="bg-surface border border-subtle rounded-2xl p-5 shadow-xl">
                  <h2 className="text-xs font-bold text-primary uppercase tracking-widest opacity-60 mb-4">Verlauf</h2>
                  <div className="space-y-3">
                    {timelineEvents.map((event) => (
                      <div key={event.id} className="flex items-start gap-3">
                        <span className={`w-2 h-2 mt-1.5 rounded-full ${eventDotClass(event.stage)}`} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-primary font-medium">
                              {EVENT_STAGE_LABELS[event.stage] || event.stage}
                            </span>
                            <span className="text-[10px] text-secondary">
                              {new Date(event.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                          </div>
                          <p className="text-xs text-secondary mt-0.5">{event.message}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Table Analysis */}
              {isTableAnalysis && transcription.analysis && (
                <div className="bg-surface border border-accent/20 rounded-2xl p-6 shadow-2xl shadow-accent/5">
                  <h2 className="text-xs font-bold text-accent uppercase tracking-widest mb-4">
                    {transcription.template === 'data_table' ? 'Datentabelle' : 'Tabellen-Ergebnis'}
                  </h2>
                  <TableRenderer
                    initialData={tablePreviewData}
                    schema={transcription.table_schema}
                    filename={transcription.original_name.replace(/\.[^/.]+$/, '')}
                    editable={false}
                  />
                </div>
              )}

              {/* Text Analysis Preview */}
              {transcription.analysis && !isTableAnalysis && (
                <div className="bg-surface border border-accent/20 rounded-2xl p-6 shadow-2xl shadow-accent/5">
                  <h2 className="text-xs font-bold text-accent uppercase tracking-widest mb-4">Ergebnis</h2>
                  <div className="space-y-4">
                    {transcription.analysis.zusammenfassung && (
                      <p className="text-sm text-primary leading-relaxed italic border-l-2 border-accent/30 pl-4">
                        {transcription.analysis.zusammenfassung}
                      </p>
                    )}
                    {editorHref && (
                      <Link
                        href={editorHref}
                        className="text-xs text-accent hover:text-info transition-colors font-bold flex items-center gap-1"
                      >
                        Vollständige Analyse im Editor bearbeiten &rarr;
                      </Link>
                    )}
                  </div>
                </div>
              )}

              {/* Raw Text */}
              <div className="bg-surface border border-subtle rounded-2xl p-6 shadow-xl">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xs font-bold text-primary uppercase tracking-widest opacity-50">{rawTextLabel}</h2>
                </div>
                <div className="text-sm text-secondary leading-relaxed whitespace-pre-wrap max-h-[400px] overflow-y-auto pr-2 custom-scrollbar font-mono opacity-80">
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
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <ConfirmDialog
        open={confirmDialogOpen}
        title={`${typeLabel} löschen`}
        message={`${typeLabel} wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.`}
        confirmLabel={`${typeLabel} löschen`}
        danger
        busy={deleting}
        onConfirm={handleDeleteTranscription}
        onCancel={() => setConfirmDialogOpen(false)}
      />
    </>
  );
}
