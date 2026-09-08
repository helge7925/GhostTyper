import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import StatusBadge from '../../components/StatusBadge';
import LoadingSpinner from '../../components/LoadingSpinner';
import { toast } from 'sonner';
import ConfirmDialog from '../../components/ConfirmDialog';
import TableRenderer from '../../components/TableRenderer';
import ProcessStatusCard from '../../components/ProcessStatusCard';
import MeetingControlBar from '../../components/MeetingControlBar';
import TranslationCompanionPanel from '../../components/TranslationCompanionPanel';
import { getTranscription, deleteTranscription, updateSpeakers, startAnalysis } from '../../lib/api';
import { STATUS } from '../../lib/constants';
import { useMessageList, useTranslations } from '../../lib/i18n';
import { useJobProgress } from '../../lib/use-job-progress';
import { Button } from '../../components/ui/button';
import { Card, CardBody } from '../../components/ui/card';
import { Field } from '../../components/ui/field';
import { ArrowLeft, CloudUpload, Download, Pencil, Play, Trash2 } from 'lucide-react';

function eventDotClass(stage) {
  if (stage === 'completed' || stage === 'vexa_recovered') return 'bg-success';
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

function getSegmentSourceId(segment, index) {
  const id = segment?.id ?? segment?.segment_id ?? segment?.source_id ?? index + 1;
  return Number.isFinite(Number(id)) ? Number(id) : index + 1;
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
  const tMeeting = useTranslations('meeting');
  const transcriptionMessages = useMessageList('loadingMessages.transcription');
  const [transcription, setTranscription] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [speakerNames, setSpeakerNames] = useState({});
  const [savingSpeakers, setSavingSpeakers] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisFocus, setAnalysisFocus] = useState('');
  const [startingProcessing, setStartingProcessing] = useState(false);
  const [processingStartError, setProcessingStartError] = useState('');
  const statusRef = useRef(null);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [nextcloudEnabled, setNextcloudEnabled] = useState(false);
  const [exportingNc, setExportingNc] = useState(false);

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

  const handleProgressSnapshot = useCallback((updated) => {
    const previousStatus = statusRef.current;
    if (previousStatus !== updated.status) {
      if (updated.status === STATUS.TRANSCRIBED) toast.success(t('progress.transcribed'));
      else if (updated.status === STATUS.ANALYZING) toast(t('progress.analyzing'));
      else if (updated.status === STATUS.COMPLETED) toast.success(t('progress.completed'));
    }
    statusRef.current = updated.status;
    setTranscription(updated);
  }, [t]);

  const jobProgress = useJobProgress(id, {
    enabled: [STATUS.PENDING, STATUS.QUEUED, STATUS.PROCESSING, STATUS.ANALYZING].includes(transcription?.status),
    initialSnapshot: transcription,
    onSnapshot: handleProgressSnapshot,
  });

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

  // Surface the "save to Nextcloud" action only when the workspace has the
  // integration enabled.
  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    let cancelled = false;
    fetch('/api/organizations/integrations/nextcloud', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (!cancelled && data) setNextcloudEnabled(!!data.enabled); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [authStatus]);

  const handleExportNextcloud = useCallback(async () => {
    setExportingNc(true);
    try {
      const res = await fetch(`/api/transcriptions/${id}/export-nextcloud`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.message || 'Export nach Nextcloud fehlgeschlagen.');
      toast.success(`Nach Nextcloud gespeichert: ${data.remotePath}`);
    } catch (err) {
      toast.error(err.message || 'Export nach Nextcloud fehlgeschlagen.');
    } finally {
      setExportingNc(false);
    }
  }, [id]);

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
          ? t('alreadyRunning')
          : 'Verarbeitung ist bereits abgeschlossen.';
      toast.success(toastMessage);
      setTranscription((prev) => prev ? { ...prev, status: nextStatus, updated_at: new Date().toISOString() } : prev);
    } catch {
      setProcessingStartError('Verarbeitung konnte nicht gestartet werden.');
    } finally {
      setStartingProcessing(false);
    }
  }, [id, t]);

  const handleSpeakerChange = useCallback((sid, name) => {
    setSpeakerNames(prev => ({ ...prev, [sid]: name }));
  }, []);

  const handleDeleteTranscription = useCallback(async () => {
    setDeleting(true);
    try {
      await deleteTranscription(id);
      router.push('/transcriptions');
    } catch (err) {
      toast.error(err.message || t('deleteFailed'));
    } finally {
      setDeleting(false);
      setConfirmDialogOpen(false);
    }
  }, [id, router, t]);

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
      steps.push({ key: 'speakers', label: t('stepSpeakers') });
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
      description = t('queuedDescription');
    } else if (transcription.status === STATUS.PROCESSING) {
      activeStep = 0;
      title = t('processingTitle');
      description = 'Das Audio wird gerade in Text umgewandelt.';
    } else if (transcription.status === STATUS.PENDING) {
      activeStep = 0;
      title = 'Wartet auf Verarbeitung';
      description = 'Der Auftrag wurde gespeichert und wird gleich gestartet.';
    } else if (transcription.status === STATUS.TRANSCRIBED) {
      if (needsSpeakerAssignment) {
        activeStep = 1;
        title = 'Transkription ist fertig';
        description = t('speakersPendingDescription');
      } else {
        done = !hasAutoAnalysis;
        activeStep = hasAutoAnalysis ? Math.max(steps.length - 1, 0) : steps.length;
        title = hasAutoAnalysis ? 'Transkription ist fertig' : 'Transkription abgeschlossen';
        description = hasAutoAnalysis
          ? 'Die Analyse wurde noch nicht gestartet.'
          : t('readyForEditorDescription');
      }
    } else if (transcription.status === STATUS.ANALYZING) {
      activeStep = Math.max(steps.length - 1, 1);
      title = t('analyzingTitle');
      description = 'Der transkribierte Text wird jetzt zusammengefasst und strukturiert.';
    } else if (transcription.status === STATUS.COMPLETED) {
      done = true;
      activeStep = steps.length;
      title = 'Verarbeitung abgeschlossen';
      description = t('availableDescription');
    }

    return { title, description, steps, activeStep, done };
  }, [transcription, t]);

  const processMessages = useMemo(() => {
    if (!transcription) return [];
    // All states share the same translated transcription pool — the
    // ProcessStatusCard's own status label already disambiguates the
    // user-facing distinction. The per-status German pools that used to sit
    // behind this return were unreachable from the moment that decision was
    // made, and are gone with it.
    return transcriptionMessages;
  }, [transcription, transcriptionMessages]);

  if (authStatus === 'loading' || loading) return <LoadingSpinner />;
  if (!transcription) return <LoadingSpinner />;

  const isOCR = transcription.mime_type?.startsWith('image/') || transcription.mime_type === 'application/pdf';
  const isOfficeDocument = isDownloadableOfficeDocument(transcription.mime_type);
  const typeLabel = isOfficeDocument ? 'Datei' : isOCR ? 'Dokument' : 'Transkription';
  const rawTextLabel = isOfficeDocument
    ? t('rawTextOffice')
    : isOCR ? t('rawTextOcr') : t('rawTextTranscript');
  // `aufmass` is still translated here as a legacy label for pre-existing
  // rows; it is no longer offered as a new template choice in the UI.
  const templateLabel = t(`templateLabels.${transcription.template}`) || transcription.template;
  const timelineEvents = Array.isArray(transcription.events) ? transcription.events : [];

  return (
    <>
      <Head><title>{transcription.original_name} - GhostTyper</title></Head>

      {(
        <div className="max-w-6xl mx-auto animate-fade-in pb-20">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => router.push('/transcriptions')}
            className="-ml-3 mb-5"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            {t('backToList')}
          </Button>

          <header className="mb-7">
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <StatusBadge status={transcription.budget_stop_state !== 'none' ? STATUS.BUDGET_STOPPED : transcription.status} />
              <span className="text-xs text-secondary">
                {new Date(transcription.created_at).toLocaleDateString('de-DE')} · {typeLabel}
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-primary break-words">
              {transcription.original_name}
            </h1>
          </header>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: Info & Actions */}
            <aside className="lg:col-span-1 space-y-5">
              <Card>
                <CardBody className="p-5">
                {/* Context & Settings */}
                <div className="space-y-4">
                  <div>
                    <p className="text-xs font-medium text-secondary">Auswertung</p>
                    <p className="text-sm text-primary mt-1 capitalize">{templateLabel || 'Keine'}</p>
                    {transcription.analysis_type === 'table' && (
                      <p className="text-xs text-secondary mt-1">
                        {transcription.template === 'data_table' ? 'Datentabellen-Extraktion' : 'Tabellen-Extraktion'}
                      </p>
                    )}
                  </div>
                  {transcription.custom_prompt && (
                    <div>
                      <p className="text-xs font-medium text-secondary">{t('extraInstruction')}</p>
                      <p className="text-xs leading-5 text-primary mt-1">&quot;{transcription.custom_prompt}&quot;</p>
                    </div>
                  )}
                </div>

                <div className="mt-5 pt-5 border-t border-subtle flex flex-col gap-2">
                  {[STATUS.PENDING, STATUS.ERROR].includes(transcription.status) && (
                    <Button
                      onClick={handleStartProcessing}
                      disabled={startingProcessing}
                      variant="primary"
                      className="w-full"
                    >
                      <Play className="w-4 h-4" aria-hidden="true" />
                      {startingProcessing
                        ? 'Startet…'
                        : transcription.status === STATUS.ERROR
                          ? 'Erneut versuchen'
                          : 'Verarbeitung starten'}
                    </Button>
                  )}
                  {(() => {
                    const canOpen = !isOfficeDocument && (transcription.text || transcription.analysis);
                    const label = isTableAnalysis ? t('openTableEditor') : t('openInEditor');
                    if (!canOpen || !editorHref) {
                      return (
                        <Button disabled variant="primary" className="w-full">
                          <Pencil className="w-4 h-4" aria-hidden="true" />
                          {label}
                        </Button>
                      );
                    }
                    return (
                      <Button asChild variant="primary" className="w-full">
                        <Link href={editorHref}>
                          <Pencil className="w-4 h-4" aria-hidden="true" />
                          {label}
                        </Link>
                      </Button>
                    );
                  })()}

                  {nextcloudEnabled && (transcription.text || transcription.analysis) && (
                    <Button
                      type="button"
                      onClick={handleExportNextcloud}
                      disabled={exportingNc}
                      variant="outline"
                      className="w-full"
                    >
                      <CloudUpload className="w-4 h-4" aria-hidden="true" />
                      {exportingNc ? 'Speichert…' : 'Nach Nextcloud speichern'}
                    </Button>
                  )}
                  {isOfficeDocument && (
                    <Button asChild variant="primary" className="w-full">
                      <a href={`/api/transcriptions/${transcription.id}/download`}>
                        <Download className="w-4 h-4" aria-hidden="true" />
                        {t('downloadTranslated')}
                      </a>
                    </Button>
                  )}
                  <details className="mt-3 pt-3 border-t border-subtle group">
                    <summary className="text-xs text-secondary cursor-pointer select-none hover:text-primary">
                      Weitere Aktionen
                    </summary>
                    <Button
                      onClick={() => setConfirmDialogOpen(true)}
                      variant="destructive"
                      size="sm"
                      className="w-full mt-3"
                      disabled={deleting}
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                      {deleting ? t('deleteBusy', { type: typeLabel }) : t('deleteAction', { type: typeLabel })}
                    </Button>
                  </details>
                </div>
                {processingStartError && (
                  <div role="alert" className="mt-3 border border-danger/30 text-danger rounded-lg p-3 text-xs">
                    {processingStartError}
                  </div>
                )}
                </CardBody>
              </Card>

              {/* Speaker Assignment */}
              {transcription.status === STATUS.TRANSCRIBED && speakerIds.length > 0 && !isOCR && (
                <Card>
                  <CardBody className="p-5">
                  <h3 className="text-sm font-semibold text-primary mb-1">{t('speakerHeading')}</h3>
                  <p className="text-xs text-secondary mb-4">{t('speakerCheckHint')}</p>
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
                  <Field
                    label="Fokus der Analyse"
                    help={t('analysisFocusHelp')}
                    className="mt-4"
                  >
                    <textarea
                      value={analysisFocus}
                      onChange={(event) => setAnalysisFocus(event.target.value)}
                      rows={2}
                      placeholder="Worauf soll sich das KI-Modell bei der Analyse konzentrieren?"
                      className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-xs text-primary outline-none focus:ring-1 focus:ring-accent resize-y"
                    />
                  </Field>
                  <Button onClick={handleStartAnalysis} disabled={analyzing} variant="primary" className="w-full mt-4">
                    {analyzing ? t('analysisRunning') : t('startAnalysis')}
                  </Button>
                  </CardBody>
                </Card>
              )}
            </aside>

            {/* Right: Preview Area */}
            <div className="lg:col-span-2 space-y-6">
              {transcription.budget_stop_state !== 'none' && (
                <div className="bg-danger/10 border border-danger/30 text-danger rounded-2xl p-4 text-sm" role="status">
                  <p className="font-semibold">{t('budgetStoppedTitle')}</p>
                  <p className="mt-1 text-xs">{t('budgetStoppedDescription')}</p>
                </div>
              )}
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
                  steps={jobProgress.steps.map((step) => ({ ...step, label: t(`progress.steps.${step.key}`) }))}
                  activeStep={jobProgress.activeStep}
                  done={jobProgress.done}
                  startedAt={jobProgress.startedAt}
                  etaTotalSeconds={jobProgress.etaTotalSeconds}
                  connectionLabel={['stale', 'unavailable', 'polling'].includes(jobProgress.connectionState)
                    ? t(`progress.connection.${jobProgress.connectionState}`)
                    : ''}
                  etaLabels={{
                    remaining: t('progress.eta.remaining'),
                    near: t('progress.eta.near'),
                    overdue: t('progress.eta.overdue'),
                  }}
                  messages={processMessages}
                />
              )}

              {transcription.status === STATUS.ERROR && (
                <div role="alert" className="border border-danger/30 text-danger rounded-xl p-4 text-sm space-y-3">
                  <p>{transcription.error || 'Verarbeitung fehlgeschlagen. Bitte erneut versuchen.'}</p>
                  {transcription.bot_status === 'rejected' && (
                    <Link
                      href="/upload?preset=meet-tab-audio"
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border border-danger/40 hover:bg-danger/10 transition-colors"
                    >
                      {tMeeting('start.meetBlocked.cta')}
                    </Link>
                  )}
                </div>
              )}

              {timelineEvents.length > 0 && (
                <Card>
                  <CardBody className="p-5">
                  <h2 className="text-sm font-semibold text-primary mb-4">Verlauf</h2>
                  <div className="space-y-3">
                    {timelineEvents.map((event) => (
                      <div key={event.id} className="flex items-start gap-3">
                        <span className={`w-2 h-2 mt-1.5 rounded-full ${eventDotClass(event.stage)}`} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-primary font-medium">
                              {t(`eventStages.${event.stage}`) || event.stage}
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
                  </CardBody>
                </Card>
              )}

              {/* Table Analysis */}
              {isTableAnalysis && transcription.analysis && (
                <Card>
                  <CardBody className="p-6">
                  <h2 className="text-sm font-semibold text-primary mb-4">
                    {transcription.template === 'data_table' ? 'Datentabelle' : 'Tabellen-Ergebnis'}
                  </h2>
                  <TableRenderer
                    initialData={tablePreviewData}
                    schema={transcription.table_schema}
                    filename={transcription.original_name.replace(/\.[^/.]+$/, '')}
                    editable={false}
                  />
                  </CardBody>
                </Card>
              )}

              {/* Text Analysis Preview */}
              {transcription.analysis && !isTableAnalysis && (
                <Card>
                  <CardBody className="p-6">
                  <h2 className="text-sm font-semibold text-primary mb-4">Ergebnis</h2>
                  <div className="space-y-4">
                    {transcription.analysis.zusammenfassung && (
                      <p className="text-sm text-primary leading-relaxed italic border-l-2 border-accent/30 pl-4">
                        {transcription.analysis.zusammenfassung}
                      </p>
                    )}
                    {editorHref && (
                      <Link
                        href={editorHref}
                        className="text-xs text-secondary hover:text-primary transition-colors font-medium flex items-center gap-1"
                      >
                        {t('editFullAnalysis')} &rarr;
                      </Link>
                    )}
                  </div>
                  </CardBody>
                </Card>
              )}

              {/* Raw Text */}
              <Card>
                <CardBody className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 id="transcript" className="text-sm font-semibold text-primary">{rawTextLabel}</h2>
                </div>
                <div className="text-sm text-secondary leading-6 max-h-[440px] overflow-y-auto pr-2 custom-scrollbar scroll-smooth">
                  {Array.isArray(transcription.segments) && transcription.segments.length > 0 ? (
                    <div className="space-y-2">
                      {transcription.segments.map((segment, index) => {
                        const sourceId = getSegmentSourceId(segment, index);
                        const speaker = segment.speaker || segment.speaker_label || segment.speaker_id;
                        return (
                          <div key={`${sourceId}-${index}`} id={`segment-${sourceId}`} className="scroll-mt-24 rounded-lg px-2 py-1 hover:bg-accent/5">
                            {speaker && <span className="text-accent-ink font-semibold mr-2">{speaker}:</span>}
                            <span>{segment.text}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : transcription.text ? (
                    <div className="whitespace-pre-wrap">{transcription.text}</div>
                  ) : (
                    transcription.status === STATUS.ANALYZING
                      ? t('transcribedAnalysisRunning')
                      : t('transcriptionRunning')
                  )}
                </div>
                </CardBody>
              </Card>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirmDialogOpen}
        title={t('deleteAction', { type: typeLabel })}
        message={t('deleteMessage', { type: typeLabel })}
        confirmLabel={t('deleteAction', { type: typeLabel })}
        danger
        busy={deleting}
        onConfirm={handleDeleteTranscription}
        onCancel={() => setConfirmDialogOpen(false)}
      />
    </>
  );
}
