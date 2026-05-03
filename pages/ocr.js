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
      model: 'mistral-medium-latest',
      showAdvancedOptions: true,
    },
  },
  'ocr-summary': {
    label: 'OCR -> Zusammenfassung',
    config: {
      analyze: true,
      template: 'generic',
      model: 'mistral-small-latest',
      showAdvancedOptions: true,
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
  const [dragActive, setDragActive] = useState(false);
  
  // Template & Model states
  const [template, setTemplate] = useState('generic');
  const [model, setModel] = useState('mistral-large-latest');
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
    if (!f) return;
    if (f.size > 50 * 1024 * 1024) {
      setError('Datei ist zu groß (max. 50 MB)');
      return;
    }
    setFile(f);
  }

  function handleDropZoneKeyDown(event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      fileInputRef.current?.click();
    }
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
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('analyze', analyze ? 'true' : 'false');
    
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
      const res = await fetch('/api/ocr', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'OCR fehlgeschlagen');
      
      setMarkdown(data.markdown);
      setAnalysis(data.analysis);
      setTranscriptionId(data.transcriptionId);
      
      if (data.analysis || data.markdown) {
        setShowEditor(true);
      }
    } catch (err) {
      setError(err.message);
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
        <div className="max-w-5xl mx-auto animate-fade-in pb-20">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-bold text-primary">{t('title')}</h1>
              <p className="text-sm text-secondary mt-1">Dokumente lesen und optional zusammenfassen</p>
              {activePreset && (
                <p className="text-xs text-info bg-cyan-500/10 border border-cyan-500/20 rounded-xl px-3 py-2 mt-3 inline-flex">
                  Preset aktiv: {activePreset.label}
                </p>
              )}
            </div>
          </div>

          <div className="max-w-xl mx-auto space-y-6">
            <div 
              className={`border-2 border-dashed rounded-3xl p-12 text-center transition-all ${
                dragActive ? 'border-accent bg-accent/10 scale-[1.02]' : 'border-subtle hover:border-emphasis bg-hover-subtle'
              } ${file ? 'border-success/30 bg-success/5' : ''}`}
              role="button"
              tabIndex={0}
              aria-label="Dokument auswählen oder per Drag-and-drop hochladen"
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={handleDropZoneKeyDown}
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => { e.preventDefault(); setDragActive(false); handleFile(e.dataTransfer.files[0]); }}
            >
              <input type="file" ref={fileInputRef} onChange={(e) => handleFile(e.target.files[0])} className="hidden" accept=".pdf,image/*" />
              <input type="file" ref={cameraInputRef} onChange={(e) => handleFile(e.target.files[0])} className="hidden" accept="image/*" capture="environment" />
              
              {file ? (
                <div className="space-y-4">
                  <div className="w-16 h-16 bg-success/20 rounded-2xl flex items-center justify-center mx-auto text-success font-bold text-xl">{file.name.split('.').pop().toUpperCase()}</div>
                  <p className="text-primary font-medium">{file.name}</p>
                  <button onClick={() => setFile(null)} className="text-xs text-secondary hover:text-danger underline">Anderes Dokument</button>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="flex justify-center gap-4">
                    <button 
                      type="button"
                      onClick={() => fileInputRef.current.click()} 
                      className="flex flex-col items-center gap-2 bg-hover hover:bg-hover-strong text-primary px-6 py-4 rounded-2xl border border-subtle transition-all group w-32"
                      title="Dokument hochladen"
                    >
                      <svg className="w-8 h-8 text-accent group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      <span className="text-[10px] font-bold uppercase tracking-widest">Dokument</span>
                    </button>
                    <button 
                      type="button"
                      onClick={() => cameraInputRef.current.click()} 
                      className="flex flex-col items-center gap-2 bg-hover hover:bg-hover-strong text-primary px-6 py-4 rounded-2xl border border-subtle transition-all group w-32"
                      title="Foto machen"
                    >
                      <svg className="w-8 h-8 text-accent group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                      <span className="text-[10px] font-bold uppercase tracking-widest">Kamera</span>
                    </button>
                  </div>
                  <p className="text-primary font-medium">Dokument hochladen oder fotografieren</p>
                </div>
              )}
            </div>

            <div className="flex flex-col items-center gap-6">
              <label className="flex items-center gap-3 cursor-pointer group">
                <input type="checkbox" checked={analyze} onChange={(e) => setAnalyze(e.target.checked)} className="w-5 h-5 rounded border-subtle bg-hover-subtle accent-accent focus:ring-accent" />
                <span className="text-sm text-secondary group-hover:text-primary">{t('withAnalysis')}</span>
              </label>

              {analyze && (
                <div className="w-full max-w-sm space-y-3">
                  <button
                    type="button"
                    onClick={() => setShowAdvancedOptions((prev) => !prev)}
                    className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-subtle bg-hover-subtle text-sm text-primary hover:bg-hover-subtle transition-colors"
                    aria-expanded={showAdvancedOptions}
                  >
                    <span>Erweiterte Analyseoptionen</span>
                    <svg
                      className={`w-4 h-4 text-secondary transition-transform ${showAdvancedOptions ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {showAdvancedOptions && (
                    <div className="space-y-4 bg-hover-subtle p-4 rounded-xl border border-subtle">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] font-bold text-secondary uppercase mb-1.5 ml-1">Modus</label>
                          <select value={template} onChange={(e) => setTemplate(e.target.value)} className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-xs text-primary focus:ring-1 focus:ring-accent outline-none">
                            <option value="generic">Zusammenfassung</option><option value="meeting">Meeting</option><option value="aufmass">Aufmaß</option>
                            {templates.map(t => <option key={t.id} value={`custom-${t.id}`}>{t.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-secondary uppercase mb-1.5 ml-1">Modell</label>
                          <select value={model} onChange={(e) => setModel(e.target.value)} className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-xs text-primary focus:ring-1 focus:ring-accent outline-none">
                            <option value="mistral-small-latest">Kostengünstig / Schnell</option><option value="mistral-medium-latest">Ausgewogen</option><option value="mistral-large-latest">Qualität</option>
                          </select>
                        </div>
                      </div>
                      <textarea value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)} placeholder="Zusätzliche Anweisungen..." rows={2} className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-xs text-primary focus:ring-1 focus:ring-accent outline-none" />
                      <textarea
                        value={analysisFocus}
                        onChange={(e) => setAnalysisFocus(e.target.value)}
                        placeholder="Fokus der Analyse: Worauf soll sich das Modell konzentrieren?"
                        rows={2}
                        className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-xs text-primary focus:ring-1 focus:ring-accent outline-none"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            <button onClick={handleSubmit} disabled={loading || !file} className="w-full gradient-accent text-white py-4 rounded-2xl text-lg font-semibold shadow-lg shadow-accent/20 hover:shadow-accent/30 disabled:opacity-30 flex flex-col items-center justify-center gap-1">
              {loading ? (
                <div className="flex items-center gap-3">
                  <div className="w-5 h-5 border-2 border-emphasis border-t-white rounded-full animate-spin" />
                  <span>{loadingStep === 'analysis' ? 'Schritt 2/2: Zusammenfassung wird erstellt...' : 'Schritt 1/2: Text wird gelesen...'}</span>
                </div>
              ) : 'Vorgang starten'}
            </button>

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

      {error && <div className="mt-8 p-4 bg-danger/10 border border-danger/20 text-danger rounded-2xl text-sm text-center animate-fade-in">{error}</div>}
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}
    </>
  );
}
