import Head from 'next/head';
import { useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import { getTemplates } from '../lib/api';
import DocumentEditor from '../components/DocumentEditor';
import ProcessStatusCard from '../components/ProcessStatusCard';
import LoadingSpinner from '../components/LoadingSpinner';
import Toast from '../components/Toast';
import { analysisToHtml } from '../lib/export-utils';
import { useUiFeedback } from '../lib/use-ui-feedback';
import { useMessageList, useTranslations } from '../lib/i18n';
import { MAX_FILE_SIZE } from '../lib/constants';
import { CHAT_MODEL_OPTIONS } from '../lib/constants';
import { Button } from '../components/ui/button';
import { Card, CardBody } from '../components/ui/card';
import { Field } from '../components/ui/field';
import { Camera, ChevronDown, FileText, ScanText, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { createCaptureId, enqueueCapture, isRetryableResponse } from '../lib/offline-queue';

const OCR_LOADING_MESSAGES = [
  'Wir lesen Pixel für Pixel, damit kein Wort verloren geht.',
  'Die OCR kneift die Augen zusammen und entschlüsselt jede Zeile.',
  'Scanner-Geister flüstern uns gerade den Dokumenttext zu.',
  'Das Dokument wird gerade in maschinenlesbarem Klartext serviert.',
  'Wir sammeln Buchstaben ein, auch die besonders schüchternen.',
  'Seiten werden gerade elegant in Text verwandelt.',
  'Jede Zeile wird gerade einmal freundlich abgeklopft.',
  'Das Dokument erzählt, wir schreiben digital mit.',
  'Wir zerlegen gerade Seiten in sauber lesbare Textbausteine.',
  'Die OCR nimmt gerade Maß und setzt Buchstaben präzise ein.',
  'Papierlogik wird gerade in Bildschirmlogik übersetzt.',
  'Wir polieren gerade Silben aus Pixeln heraus.',
];

const OCR_ANALYSIS_MESSAGES = [
  'Die KI setzt gerade Ordnung ins Dokument-Chaos.',
  'Absätze werden gezähmt und in klare Aussagen verwandelt.',
  'Unser Text-Bauleiter verteilt gerade Überschriften und Struktur.',
  'Kernaussagen werden gerade gebündelt und sauber verpackt.',
  'To-dos werden markiert, sortiert und auf Hochglanz poliert.',
  'Wir machen aus Rohtext gerade eine lesbare Abkürzung.',
  'Die wichtigsten Punkte stehen schon an der Startlinie.',
  'Wir filtern gerade Rauschen weg und behalten Substanz.',
  'Das Ergebnis bekommt gerade eine klare Dramaturgie.',
  'Gedankensplitter werden gerade zu einer stringenten Story.',
  'Wir sortieren Details nach Relevanz und Schärfe.',
  'Klarheit in Arbeit: der Text bekommt Strukturkanten.',
];

const OCR_PRESETS = {
  'pdf-ocr-meeting': {
    label: 'PDF OCR -> Meeting-Protokoll',
    config: {
      analyze: true,
      template: 'meeting',
      model: 'deepseek-v4-pro',
    },
  },
  'ocr-summary': {
    label: 'OCR -> Zusammenfassung',
    config: {
      analyze: true,
      template: 'generic',
      model: 'deepseek-v4-flash',
    },
  },
};

export default function OCR() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const t = useTranslations('ocrPage');
  const ocrMessages = useMessageList('loadingMessages.ocr');
  
  const [file, setFile] = useState(null);
  const [markdown, setMarkdown] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [transcriptionId, setTranscriptionId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(''); 
  const [stepStartedAt, setStepStartedAt] = useState(null);
  const [analyze, setAnalyze] = useState(true);
  const [error, setError] = useState('');
  const [offlineSaved, setOfflineSaved] = useState(false);
  const [clientCaptureId, setClientCaptureId] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  
  // Template & Model states
  const [template, setTemplate] = useState('generic');
  const [model, setModel] = useState('deepseek-v4-pro');
  const [customPrompt, setCustomPrompt] = useState('');
  const [analysisFocus, setAnalysisFocus] = useState('');
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [templates, setTemplates] = useState([]);

  // Editor state
  const [showEditor, setShowEditor] = useState(false);
  const { toast, showToast, clearToast } = useUiFeedback();
  const activePreset = useMemo(() => {
    const presetId = typeof router.query.preset === 'string' ? router.query.preset : '';
    return OCR_PRESETS[presetId] || null;
  }, [router.query.preset]);

  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const analysisStepTimeoutRef = useRef(null);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
      return;
    }
    if (status === 'authenticated') {
      getTemplates()
        .then((templatesData) => {
          setTemplates(templatesData);
        })
        .catch(err => console.error('Error loading options:', err));
    }
  }, [status, router]);

  useEffect(() => {
    if (!activePreset) return;
    const preset = activePreset.config;
    if (typeof preset.analyze === 'boolean') setAnalyze(preset.analyze);
    if (typeof preset.template === 'string') setTemplate(preset.template);
    if (typeof preset.model === 'string') setModel(preset.model);
    if (preset.showAdvancedOptions) setShowAdvancedOptions(true);
  }, [activePreset]);

  useEffect(() => {
    return () => {
      if (analysisStepTimeoutRef.current) {
        clearTimeout(analysisStepTimeoutRef.current);
      }
    };
  }, []);

  function handleFile(f) {
    setError('');
    setOfflineSaved(false);
    if (!f) return;
    if (f.size > MAX_FILE_SIZE) {
      setError('Datei ist zu groß (max. 500 MB)');
      return;
    }
    setFile(f);
    setClientCaptureId(createCaptureId());
  }

  async function handleSubmit(e) {
    if (e) e.preventDefault();
    if (!file) return;

    setLoading(true);
    setLoadingStep('ocr');
    setStepStartedAt(new Date().toISOString());
    setError('');
    setMarkdown('');
    setAnalysis(null);
    setTranscriptionId(null);

    const captureId = clientCaptureId || createCaptureId();
    if (!clientCaptureId) setClientCaptureId(captureId);
    const userId = session?.user?.id;
    const organizationId = session?.user?.currentOrganizationId;
    const captureFields = {
      analyze,
      ...(analyze ? { template, model, customPrompt, analysisFocus } : {}),
    };
    const saveOffline = async () => {
      if (!userId || !organizationId) throw new Error(t('offlineScopeMissing'));
      await enqueueCapture({
        id: captureId,
        kind: file.type?.startsWith('image/') && template === 'data_table' ? 'photo_table' : 'ocr',
        userId,
        organizationId,
        blob: file,
        filename: file.name,
        fields: captureFields,
      });
      setFile(null);
      setClientCaptureId(null);
      setOfflineSaved(true);
    };
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('analyze', analyze ? 'true' : 'false');
    formData.append('clientCaptureId', captureId);
    formData.append('clientCaptureUserId', String(userId || ''));
    formData.append('clientCaptureOrganizationId', String(organizationId || ''));
    
    if (analyze) {
      formData.append('template', template);
      formData.append('model', model);
      if (customPrompt) formData.append('customPrompt', customPrompt);
      if (analysisFocus) formData.append('analysisFocus', analysisFocus);
      if (analysisStepTimeoutRef.current) {
        clearTimeout(analysisStepTimeoutRef.current);
      }
      analysisStepTimeoutRef.current = setTimeout(() => {
        setLoadingStep('analysis');
        setStepStartedAt(new Date().toISOString());
      }, 8000);
    }

    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        await saveOffline();
        return;
      }
      const res = await fetch('/api/ocr', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        const requestError = new Error(data.message || 'OCR fehlgeschlagen');
        requestError.status = res.status;
        throw requestError;
      }
      
      setMarkdown(data.markdown);
      setAnalysis(data.analysis);
      setTranscriptionId(data.transcriptionId);
      
      if (data.analysis || data.markdown) {
        setShowEditor(true);
      }
    } catch (err) {
      const networkFailure = err?.status === undefined;
      if ((networkFailure || isRetryableResponse(err.status)) && file) {
        try {
          await saveOffline();
        } catch (queueError) {
          setError(queueError.message || t('offlineStoreFailed'));
        }
      } else {
        setError(err.message);
      }
    } finally {
      if (analysisStepTimeoutRef.current) {
        clearTimeout(analysisStepTimeoutRef.current);
        analysisStepTimeoutRef.current = null;
      }
      setLoading(false);
      setLoadingStep('');
      setStepStartedAt(null);
    }
  }

  async function handleSaveDocument(html) {
    if (!transcriptionId) return;
    try {
      await fetch(`/api/transcriptions/${transcriptionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentHtml: html }),
      });
      showToast('Dokument in Historie gespeichert.', 'success');
    } catch {
      showToast('Fehler beim Speichern.', 'error');
    }
  }

  if (status === 'loading') return <LoadingSpinner />;
  if (!session) return <LoadingSpinner />;

  return (
    <>
      <Head><title>{`${t('title')} – GhostTyper`}</title></Head>

      {!showEditor ? (
        <div className="max-w-2xl mx-auto animate-fade-in pb-20">
          <header className="mb-7">
              <p className="text-xs font-medium text-secondary mb-2">Texterkennung</p>
              <h1 className="text-3xl font-semibold tracking-tight text-primary">{t('title')}</h1>
              <p className="text-sm leading-6 text-secondary mt-2">Lies Text aus PDFs oder Fotos aus und erstelle auf Wunsch direkt eine strukturierte Auswertung.</p>
              {activePreset && (
                <div className="flex items-start gap-3 text-sm bg-surface-elevated border border-subtle rounded-xl px-4 py-3 mt-4">
                  <span className="mt-1 h-2 w-2 rounded-full bg-info shrink-0" aria-hidden="true" />
                  <div>
                    <p className="font-medium text-primary">Passende Einstellungen sind bereits gewählt</p>
                    <p className="text-secondary mt-0.5">{activePreset.label}</p>
                  </div>
                </div>
              )}
          </header>

          <div className="space-y-5">
            <Card>
              <CardBody className="p-5 sm:p-6">
            <div 
              className={`border border-dashed rounded-xl p-8 text-center transition-colors ${
                dragActive ? 'border-accent bg-accent/5' : 'border-emphasis bg-surface-elevated/40'
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => { e.preventDefault(); setDragActive(false); handleFile(e.dataTransfer.files[0]); }}
            >
              <input type="file" ref={fileInputRef} onChange={(e) => handleFile(e.target.files[0])} className="hidden" accept=".pdf,image/*" />
              <input type="file" ref={cameraInputRef} onChange={(e) => handleFile(e.target.files[0])} className="hidden" accept="image/*" capture="environment" />
              
              {file ? (
                <div className="flex items-center justify-center gap-3 text-left">
                  <span className="h-10 w-10 rounded-lg bg-accent/10 text-accent-ink flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-primary truncate">{file.name}</p>
                    <p className="text-xs text-secondary mt-0.5">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                    Ersetzen
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => { setFile(null); setClientCaptureId(null); }} aria-label="Dokument entfernen">
                    <X className="w-4 h-4" aria-hidden="true" />
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <span className="mx-auto h-10 w-10 rounded-lg bg-surface border border-subtle text-secondary flex items-center justify-center">
                    <ScanText className="w-5 h-5" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-sm font-medium text-primary">Dokument auswählen</p>
                    <p className="text-xs text-secondary mt-1">PDF oder Bild, bis 500 MB</p>
                  </div>
                  <div className="flex justify-center gap-4">
                    <Button
                      type="button"
                      onClick={() => fileInputRef.current.click()} 
                      variant="outline"
                      title="Dokument hochladen"
                    >
                      <FileText className="w-4 h-4" aria-hidden="true" />
                      Dokument
                    </Button>
                    <Button
                      type="button"
                      onClick={() => cameraInputRef.current.click()} 
                      variant="outline"
                      title="Foto machen"
                    >
                      <Camera className="w-4 h-4" aria-hidden="true" />
                      Kamera
                    </Button>
                  </div>
                </div>
              )}
            </div>
              </CardBody>
            </Card>

            <Card>
              <CardBody className="p-5">
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={analyze} onChange={(e) => setAnalyze(e.target.checked)} className="mt-0.5 w-4 h-4 rounded border-subtle bg-hover-subtle accent-accent focus:ring-accent" />
                <span>
                  <span className="block text-sm font-medium text-primary">{t('withAnalysis')}</span>
                  <span className="block text-xs text-secondary mt-0.5">Erstellt nach der Texterkennung eine Zusammenfassung.</span>
                </span>
              </label>

              {analyze && (
                <div className="w-full space-y-3 mt-4 pt-4 border-t border-subtle">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setShowAdvancedOptions((prev) => !prev)}
                    className="w-full justify-between px-3"
                    aria-expanded={showAdvancedOptions}
                  >
                    <span>Details und Vorgaben</span>
                    <ChevronDown className={cn('w-4 h-4 text-secondary transition-transform', showAdvancedOptions && 'rotate-180')} aria-hidden="true" />
                  </Button>

                  {showAdvancedOptions && (
                    <div className="space-y-4 bg-surface-elevated/50 p-4 rounded-xl border border-subtle">
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Art der Auswertung">
                          <select value={template} onChange={(e) => setTemplate(e.target.value)} className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-xs text-primary focus:ring-1 focus:ring-accent outline-none">
                            <option value="generic">Zusammenfassung</option><option value="meeting">Meeting</option><option value="action_items">To-Dos extrahieren</option>
                            {templates.map(t => <option key={t.id} value={`custom-${t.id}`}>{t.name}</option>)}
                          </select>
                        </Field>
                        <Field label="KI-Modell" help="Der Standard passt für die meisten Dokumente.">
                          <select value={model} onChange={(e) => setModel(e.target.value)} className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-xs text-primary focus:ring-1 focus:ring-accent outline-none">
                            {CHAT_MODEL_OPTIONS.map((option) => (<option key={option.value} value={option.value}>{option.label}</option>))}
                          </select>
                        </Field>
                      </div>
                      <Field label="Zusätzliche Anweisung" help="Optional: Begriffe, Format oder Kontext für die Auswertung.">
                        <textarea value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)} rows={2} className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-xs text-primary focus:ring-1 focus:ring-accent outline-none" />
                      </Field>
                      <Field label="Fokus der Analyse" help="Optional: Was ist in diesem Dokument besonders wichtig?">
                      <textarea
                        value={analysisFocus}
                        onChange={(e) => setAnalysisFocus(e.target.value)}
                        rows={2}
                        className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-xs text-primary focus:ring-1 focus:ring-accent outline-none"
                      />
                      </Field>
                    </div>
                  )}
                </div>
              )}
              </CardBody>
            </Card>

            <Button onClick={handleSubmit} disabled={loading || !file} variant="primary" size="lg" className="w-full">
              {loading ? (
                <div className="flex items-center gap-3">
                  <div className="w-5 h-5 border-2 border-emphasis border-t-white rounded-full animate-spin" />
                  <span>{loadingStep === 'analysis' ? 'Schritt 2/2: Zusammenfassung wird erstellt...' : 'Schritt 1/2: Text wird gelesen...'}</span>
                </div>
              ) : 'Text erkennen'}
            </Button>

            {loading && (
              <ProcessStatusCard
                title={loadingStep === 'analysis' ? 'Zusammenfassung wird erstellt' : 'Text wird gelesen'}
                description={loadingStep === 'analysis'
                  ? 'Der extrahierte Text wird zusammengefasst.'
                  : 'Der Dokumenttext wird aus Datei oder Foto gelesen.'}
                steps={analyze
                  ? [
                    { key: 'ocr', label: 'Text aus Dokument extrahieren' },
                    { key: 'analysis', label: 'Text strukturieren' },
                  ]
                  : [
                    { key: 'ocr', label: 'Text aus Dokument extrahieren' },
                  ]}
                activeStep={analyze && loadingStep === 'analysis' ? 1 : 0}
                done={false}
                startedAt={stepStartedAt}
                etaSeconds={loadingStep === 'analysis' ? 22 : 16}
                messages={ocrMessages}
              />
            )}
          </div>
        </div>
      ) : (
        <DocumentEditor 
          initialHtml={analysisToHtml({ original_name: file?.name || 'OCR Dokument', created_at: new Date(), text: markdown, analysis: analysis })}
          filename={file?.name || 'ocr-export'}
          sidebarContent={markdown}
          sourceLabel="Originaltext"
          onSave={handleSaveDocument}
          onCancel={() => setShowEditor(false)}
        />
      )}

      {error && <div role="alert" className="mt-8 p-4 border border-danger/30 text-danger rounded-xl text-sm text-center animate-fade-in">{error}</div>}
      {offlineSaved && <div role="status" className="mt-8 p-4 border border-success/30 bg-success/10 text-success rounded-xl text-sm text-center animate-fade-in">{t('savedOffline')}</div>}
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}
    </>
  );
}
