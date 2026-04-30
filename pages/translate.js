import Head from 'next/head';
import { useState, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import { mdToHtml } from '../lib/export-utils';
import DocumentEditor from '../components/DocumentEditor';
import ProcessStatusCard from '../components/ProcessStatusCard';
import LoadingSpinner from '../components/LoadingSpinner';
import { saveDocument } from '../lib/api';

const LANGUAGES = [
  { code: 'German', label: 'Deutsch' },
  { code: 'English', label: 'Englisch' },
  { code: 'French', label: 'Französisch' },
  { code: 'Spanish', label: 'Spanisch' },
  { code: 'Italian', label: 'Italienisch' },
  { code: 'Dutch', label: 'Niederländisch' },
  { code: 'Portuguese', label: 'Portugiesisch' },
  { code: 'Polish', label: 'Polnisch' },
  { code: 'Russian', label: 'Russisch' },
  { code: 'Japanese', label: 'Japanisch' },
  { code: 'Chinese', label: 'Chinesisch' },
];

const TRANSLATE_OCR_MESSAGES = [
  'Wir entziffern das Dokument gerade wie ein Rätselheft.',
  'Die OCR sucht jedes Zeichen, auch die besonders schüchternen.',
  'Scanner-Modus aktiv: Buchstaben werden eingesammelt.',
  'Das Dokument wird in Text umgegossen - ganz ohne Krümel.',
  'Wir lesen gerade jede Zeile mit Adleraugen.',
  'Die Seiten flüstern, wir schreiben mit.',
];

const TRANSLATION_MESSAGES = [
  'Wörter packen gerade ihre Koffer für die Zielsprache.',
  'Der Satzbau macht einen kleinen Urlaub und kommt übersetzt zurück.',
  'Unsere Übersetzungs-Elfen feilen am Feinschliff.',
  'Wir retten Bedeutung, Tonfall und Nuancen vor dem Zoll.',
  'Der Text zieht gerade in eine neue Sprachwohnung um.',
  'Feinschliff läuft: gleiche Aussage, neue Sprache.',
];

export default function Translate() {
  const { data: session, status } = useSession();
  const router = useRouter();
  
  const [text, setText] = useState('');
  const [targetLanguage, setTargetLanguage] = useState('German');
  const [model, setModel] = useState('mistral-large-latest');
  const [translatedText, setTranslatedText] = useState('');
  const [loading, setLoading] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [loadingStartedAt, setLoadingStartedAt] = useState(null);
  const [error, setError] = useState('');
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [mode, setMode] = useState('text');
  const [officeFile, setOfficeFile] = useState(null);
  const [officeLoading, setOfficeLoading] = useState(false);
  const [officeResult, setOfficeResult] = useState(null);

  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  const handleOcr = async (file) => {
    if (!file) return;
    setOcrLoading(true);
    setLoadingStartedAt(new Date().toISOString());
    setError('');
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('analyze', 'false');

    try {
      const res = await fetch('/api/ocr', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setText(data.markdown);
    } catch (err) {
      setError('OCR fehlgeschlagen: ' + err.message);
    } finally {
      setOcrLoading(false);
      setLoadingStartedAt(null);
    }
  };

  async function handleTranslate(e) {
    if (e) e.preventDefault();
    if (!text.trim()) return;

    setLoading(true);
    setLoadingStartedAt(new Date().toISOString());
    setError('');
    
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, targetLanguage, model }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Übersetzung fehlgeschlagen');
      
      setTranslatedText(data.translatedText);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setLoadingStartedAt(null);
    }
  }

  function getDownloadName(response, fallbackName) {
    const disposition = response.headers.get('content-disposition') || '';
    const match = disposition.match(/filename="([^"]+)"/);
    if (match?.[1]) return match[1];
    return fallbackName.replace(/\.[^/.]+$/, '') + '_translated' + (fallbackName.match(/\.[^/.]+$/)?.[0] || '');
  }

  async function handleOfficeTranslate(event) {
    event.preventDefault();
    if (!officeFile || officeLoading) return;

    setOfficeLoading(true);
    setLoadingStartedAt(new Date().toISOString());
    setOfficeResult(null);
    setError('');

    const formData = new FormData();
    formData.append('file', officeFile);
    formData.append('targetLanguage', targetLanguage);
    formData.append('sourceLanguage', 'auto');
    formData.append('model', model);

    try {
      const response = await fetch('/api/translate/file', {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.message || 'Office-Dateiübersetzung fehlgeschlagen');
      }

      const blob = await response.blob();
      const filename = getDownloadName(response, officeFile.name);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
      setOfficeResult({
        filename,
        historyId: response.headers.get('x-ghosttyper-history-id'),
        warningCount: Number(response.headers.get('x-ghosttyper-layout-warnings') || 0),
      });
    } catch (err) {
      setError(err.message || 'Office-Dateiübersetzung fehlgeschlagen');
    } finally {
      setOfficeLoading(false);
      setLoadingStartedAt(null);
    }
  }

  async function handleSaveDocument(html) {
    try {
      await saveDocument({
        title: `Übersetzung: ${targetLanguage} (${new Date().toLocaleDateString('de-DE')})`,
        text: text,
        documentHtml: html,
        template: 'translation'
      });
      return Promise.resolve();
    } catch (err) {
      setError('Fehler beim Speichern: ' + err.message);
      return Promise.reject(err);
    }
  }

  if (status === 'loading') return <LoadingSpinner />;
  if (!session) return <LoadingSpinner />;

  return (
    <>
      <Head><title>Übersetzung - GhostTyper</title></Head>

      {!translatedText ? (
        <div className="max-w-5xl mx-auto pb-20 px-2 sm:px-0 animate-fade-in">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-primary">Übersetzung</h1>
            <p className="text-sm text-secondary mt-1">Text übersetzen, PDF/Bilder per OCR übernehmen oder Office-Dateien formatwahrend übersetzen.</p>
          </div>

          <div className="mb-6 inline-flex rounded-2xl border border-subtle bg-surface p-1">
            <button
              type="button"
              onClick={() => setMode('text')}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
                mode === 'text' ? 'bg-accent text-white' : 'text-secondary hover:text-primary'
              }`}
            >
              Text / OCR
            </button>
            <button
              type="button"
              onClick={() => setMode('office')}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
                mode === 'office' ? 'bg-accent text-white' : 'text-secondary hover:text-primary'
              }`}
            >
              Office-Datei
            </button>
          </div>

          {mode === 'office' ? (
            <form onSubmit={handleOfficeTranslate} className="space-y-6">
              <div className="bg-surface border border-subtle rounded-2xl p-6">
                <label htmlFor="office-translation-file" className="block text-xs font-bold uppercase tracking-widest text-secondary mb-3">
                  DOCX, XLSX oder PPTX
                </label>
                <input
                  id="office-translation-file"
                  type="file"
                  accept=".docx,.xlsx,.pptx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                  onChange={(event) => setOfficeFile(event.target.files?.[0] || null)}
                  className="block w-full text-sm text-secondary file:mr-4 file:rounded-xl file:border-0 file:bg-hover-strong file:px-4 file:py-2 file:text-sm file:font-semibold file:text-primary hover:file:bg-hover-strong"
                />
                <p className="mt-3 text-xs text-secondary">
                  Die App ersetzt nur Textinhalte. Layout, Zellformate, Folien, Bilder und eingebettete Medien bleiben im Office-Paket erhalten. PDF bleibt ein OCR-Workflow ohne Layoutgarantie.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-surface border border-subtle rounded-2xl p-5">
                  <label htmlFor="office-target-language" className="block text-xs font-bold uppercase tracking-widest text-secondary mb-2">
                    Zielsprache
                  </label>
                  <select
                    id="office-target-language"
                    value={targetLanguage}
                    onChange={(event) => setTargetLanguage(event.target.value)}
                    className="w-full bg-surface-elevated border border-subtle rounded-xl px-4 py-3 text-sm text-primary outline-none focus:ring-1 focus:ring-accent"
                  >
                    {LANGUAGES.map(lang => <option key={lang.code} value={lang.code}>{lang.label}</option>)}
                  </select>
                </div>
                <div className="bg-surface border border-subtle rounded-2xl p-5">
                  <label htmlFor="office-model" className="block text-xs font-bold uppercase tracking-widest text-secondary mb-2">
                    KI-Modell
                  </label>
                  <select
                    id="office-model"
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    className="w-full bg-surface-elevated border border-subtle rounded-xl px-4 py-3 text-sm text-primary outline-none focus:ring-1 focus:ring-accent"
                  >
                    <option value="mistral-small-latest">Kostengünstig / Schnell</option>
                    <option value="mistral-medium-latest">Ausgewogen</option>
                    <option value="mistral-large-latest">Qualität</option>
                  </select>
                </div>
              </div>

              {officeLoading && (
                <ProcessStatusCard
                  title="Office-Datei wird übersetzt"
                  description="Textsegmente werden aus der Datei gelesen, übersetzt und in das ursprüngliche Office-Paket zurückgeschrieben."
                  steps={[{ key: 'office-translation', label: 'Office-Texte übersetzen' }]}
                  activeStep={0}
                  done={false}
                  startedAt={loadingStartedAt}
                  etaSeconds={30}
                  messages={TRANSLATION_MESSAGES}
                />
              )}

              {officeResult && (
                <div className="bg-success/10 border border-success/20 text-success rounded-2xl p-4 text-sm">
                  Datei erstellt: {officeResult.filename}
                  {officeResult.warningCount > 0 ? ` (${officeResult.warningCount} mögliche Layout-Hinweise wegen längerer Übersetzungen)` : ''}
                </div>
              )}

              <button
                type="submit"
                disabled={officeLoading || !officeFile}
                className="w-full gradient-accent text-white py-4 rounded-2xl text-lg font-bold shadow-lg shadow-accent/20 disabled:opacity-30 transition-all"
              >
                {officeLoading ? 'Datei wird übersetzt...' : 'Office-Datei übersetzen'}
              </button>
            </form>
          ) : (
          <div className="space-y-6">
            {/* Input Area */}
            <div className="space-y-4">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-bold text-secondary uppercase tracking-wider">Eingabetext</span>
                <div className="flex items-center gap-2">
                  <input type="file" ref={fileInputRef} onChange={e => handleOcr(e.target.files[0])} accept=".pdf,image/*" className="hidden" />
                  <input type="file" ref={cameraInputRef} onChange={e => handleOcr(e.target.files[0])} accept="image/*" capture="environment" className="hidden" />
                  
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 bg-hover-subtle hover:bg-hover-strong text-primary px-4 py-2 rounded-xl text-xs font-bold border border-subtle transition-all" title="Dokument hochladen" aria-label="Dokument für OCR hochladen">
                    <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    <span className="hidden sm:inline">Dokument</span>
                  </button>
                  <button type="button" onClick={() => cameraInputRef.current?.click()} className="flex items-center gap-2 bg-hover-subtle hover:bg-hover-strong text-primary px-4 py-2 rounded-xl text-xs font-bold border border-subtle transition-all" title="Foto machen" aria-label="Foto aufnehmen und OCR starten">
                    <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    <span className="hidden sm:inline">Kamera</span>
                  </button>
                  <button type="button" onClick={() => setText('')} className="p-2 text-secondary hover:text-danger bg-hover-subtle rounded-xl transition-colors" aria-label="Eingabetext leeren"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></svg></button>
                </div>
              </div>
              
              <div className={`bg-surface border border-subtle rounded-3xl overflow-hidden focus-within:border-accent/30 transition-all shadow-2xl relative ${ocrLoading || loading ? 'opacity-50' : ''}`}>
                {(ocrLoading || loading) && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-overlay backdrop-blur-sm">
                    <div className="w-10 h-10 border-2 border-accent border-t-transparent rounded-full animate-spin mb-3" />
                    <span className="text-xs font-bold text-accent uppercase tracking-widest">{ocrLoading ? 'Extrahiere Text...' : 'Übersetze...'}</span>
                  </div>
                )}
                <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Text hier einfügen oder Dokument oben scannen..." className="w-full h-[400px] bg-transparent p-8 text-primary placeholder-text-secondary/20 outline-none resize-none text-base leading-relaxed custom-scrollbar" />
              </div>

              {(ocrLoading || loading) && (
                <ProcessStatusCard
                  title={ocrLoading ? 'OCR läuft' : 'Übersetzung läuft'}
                  description={ocrLoading
                    ? 'Text wird aus dem Dokument extrahiert.'
                    : 'Der erkannte Text wird in die Zielsprache übersetzt.'}
                  steps={[{ key: ocrLoading ? 'ocr' : 'translation', label: ocrLoading ? 'Dokument lesen' : 'Text übersetzen' }]}
                  activeStep={0}
                  done={false}
                  startedAt={loadingStartedAt}
                  etaSeconds={ocrLoading ? 16 : 14}
                  messages={ocrLoading ? TRANSLATE_OCR_MESSAGES : TRANSLATION_MESSAGES}
                />
              )}
            </div>

            {/* Language Selection & Action */}
            <div className="flex flex-col items-center gap-6 py-4">
              <div className="flex items-center gap-4 bg-surface border border-subtle rounded-2xl px-6 py-3 shadow-xl">
                <span className="text-xs font-bold text-secondary uppercase tracking-widest">Zielsprache:</span>
                <select value={targetLanguage} onChange={(e) => setTargetLanguage(e.target.value)} className="bg-hover-subtle border border-subtle text-accent font-bold text-sm rounded-xl px-4 py-2 outline-none hover:bg-hover-strong transition-all cursor-pointer">
                  {LANGUAGES.map(lang => <option key={lang.code} value={lang.code}>{lang.label}</option>)}
                </select>
              </div>

              <div className="w-full max-w-md">
                <button
                  type="button"
                  onClick={() => setShowAdvancedOptions((prev) => !prev)}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-subtle bg-hover-subtle text-sm text-primary hover:bg-hover-subtle transition-colors"
                  aria-expanded={showAdvancedOptions}
                >
                  <span>Erweiterte Optionen</span>
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
                  <div className="mt-3 bg-surface border border-subtle rounded-2xl px-4 py-3 shadow-xl">
                    <label className="text-[10px] font-bold text-secondary uppercase tracking-widest opacity-60">Modell</label>
                    <select value={model} onChange={e => setModel(e.target.value)} className="mt-2 w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-sm text-primary focus:ring-1 focus:ring-accent outline-none">
                      <option value="mistral-small-latest">Kostengünstig / Schnell</option>
                      <option value="mistral-medium-latest">Ausgewogen</option>
                      <option value="mistral-large-latest">Qualität</option>
                    </select>
                    <p className="mt-2 text-[11px] text-secondary">
                      Eine Auswahl reicht: Kostengünstig / Schnell, Ausgewogen oder Qualität.
                    </p>
                  </div>
                )}
              </div>

              <button onClick={handleTranslate} disabled={loading || ocrLoading || !text.trim()} className="w-full max-w-md gradient-accent text-white py-4 rounded-2xl text-lg font-bold shadow-lg shadow-accent/20 hover:shadow-accent/40 disabled:opacity-30 transition-all hover:scale-[1.02] active:scale-95">
                {loading ? 'Wird übersetzt...' : 'Übersetzung starten'}
              </button>
            </div>
          </div>
          )}
        </div>
      ) : (
        <DocumentEditor 
          initialHtml={mdToHtml(translatedText)}
          filename={`Uebersetzung_${targetLanguage}`}
          sidebarContent={text}
          sourceLabel="Originaltext"
          onSave={handleSaveDocument}
          onCancel={() => setTranslatedText('')}
        />
      )}

      {error && <div className="mt-8 p-4 bg-danger/10 border border-danger/20 text-danger rounded-2xl text-sm text-center animate-fade-in shadow-xl mx-auto max-w-5xl">{error}</div>}
    </>
  );
}
