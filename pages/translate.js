import Head from 'next/head';
import { useState, useRef, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import { mdToHtml } from '../lib/export-utils';
import DocumentEditor from '../components/DocumentEditor';
import ProcessStatusCard from '../components/ProcessStatusCard';
import LoadingSpinner from '../components/LoadingSpinner';
import { saveDocument } from '../lib/api';
import { useMessageList, useMessageObject, useTranslations } from '../lib/i18n';

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

export default function Translate() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const t = useTranslations('translatePage');
  const tPdf = useTranslations('translatePage.pdf');
  const translationMessages = useMessageList('loadingMessages.translation');
  const translateOcrMessages = useMessageList('loadingMessages.ocr');
  const outputLanguageLabels = useMessageObject('translatePage.outputLanguageLabel');

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
  const [editorOpen, setEditorOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState('source');
  const [copyFeedback, setCopyFeedback] = useState(false);

  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  // When the user changes the source text after a translation, mobile should
  // jump back to the source tab so they see what they're editing.
  function updateSourceText(value) {
    setText(value);
    if (translatedText) setMobileTab('source');
  }

  const fallbackLabel = t('outputFallbackLabel');
  const languageLabel = useMemo(
    () => outputLanguageLabels?.[targetLanguage] || fallbackLabel,
    [outputLanguageLabels, targetLanguage, fallbackLabel],
  );

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
      setMobileTab('result');
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
    const ext = fallbackName.match(/\.[^/.]+$/)?.[0] || '';
    return `${fallbackName.replace(/\.[^/.]+$/, '')} - ${languageLabel}${ext}`;
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
    formData.append('languageLabel', languageLabel);
    formData.append('fallbackLabel', fallbackLabel);

    try {
      const response = await fetch('/api/translate/file', {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.message || 'Datei-Übersetzung fehlgeschlagen');
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
      const isPdfOutput = (response.headers.get('content-type') || '').includes('pdf');
      setOfficeResult({
        filename,
        historyId: response.headers.get('x-ghosttyper-history-id'),
        warningCount: Number(response.headers.get('x-ghosttyper-layout-warnings') || 0),
        isPdf: isPdfOutput,
      });
    } catch (err) {
      setError(err.message || 'Datei-Übersetzung fehlgeschlagen');
    } finally {
      setOfficeLoading(false);
      setLoadingStartedAt(null);
    }
  }

  async function handleCopyTranslation() {
    if (!translatedText) return;
    try {
      await navigator.clipboard.writeText(translatedText);
      setCopyFeedback(true);
      window.setTimeout(() => setCopyFeedback(false), 2000);
    } catch {
      // Some browsers (e.g. http on Safari) block clipboard.writeText —
      // fall back to a one-shot textarea select+execCommand.
      const ta = document.createElement('textarea');
      ta.value = translatedText;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); setCopyFeedback(true); window.setTimeout(() => setCopyFeedback(false), 2000); } catch {/* no-op */}
      document.body.removeChild(ta);
    }
  }

  async function handleSaveDocument(html) {
    try {
      await saveDocument({
        title: `Übersetzung: ${targetLanguage} (${new Date().toLocaleDateString('de-DE')})`,
        text: text,
        documentHtml: html,
        template: 'translation',
      });
      return Promise.resolve();
    } catch (err) {
      setError('Fehler beim Speichern: ' + err.message);
      return Promise.reject(err);
    }
  }

  if (status === 'loading') return <LoadingSpinner />;
  if (!session) return <LoadingSpinner />;

  // ----- Editor full-screen when explicitly requested -----
  if (editorOpen && translatedText) {
    return (
      <>
        <Head><title>{`${t('title')} – GhostTyper`}</title></Head>
        <DocumentEditor
          initialHtml={mdToHtml(translatedText)}
          filename={`Uebersetzung_${targetLanguage}`}
          sidebarContent={text}
          sourceLabel="Originaltext"
          onSave={handleSaveDocument}
          onCancel={() => setEditorOpen(false)}
        />
      </>
    );
  }

  return (
    <>
      <Head><title>{`${t('title')} – GhostTyper`}</title></Head>

      <div className="max-w-7xl mx-auto pb-20 px-2 sm:px-0 animate-fade-in">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-primary">{t('title')}</h1>
          <p className="text-sm text-secondary mt-1">{t('subtitle')}</p>
        </div>

        <div className="mb-6 inline-flex rounded-2xl border border-subtle bg-surface p-1">
          <button
            type="button"
            onClick={() => setMode('text')}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
              mode === 'text' ? 'bg-accent text-white' : 'text-secondary hover:text-primary'
            }`}
          >
            {t('tabText')}
          </button>
          <button
            type="button"
            onClick={() => setMode('office')}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
              mode === 'office' ? 'bg-accent text-white' : 'text-secondary hover:text-primary'
            }`}
          >
            {t('tabFile')}
          </button>
        </div>

        {mode === 'office' ? (
          <form onSubmit={handleOfficeTranslate} className="space-y-6 max-w-5xl">
            <div className="bg-surface border border-subtle rounded-2xl p-6">
              <label htmlFor="office-translation-file" className="block text-xs font-bold uppercase tracking-widest text-secondary mb-3">
                PDF, DOCX, XLSX oder PPTX
              </label>
              <input
                id="office-translation-file"
                type="file"
                accept=".pdf,.docx,.xlsx,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                onChange={(event) => setOfficeFile(event.target.files?.[0] || null)}
                className="block w-full text-sm text-secondary file:mr-4 file:rounded-xl file:border-0 file:bg-hover-strong file:px-4 file:py-2 file:text-sm file:font-semibold file:text-primary hover:file:bg-hover-strong"
              />
              <p className="mt-3 text-xs text-secondary">{tPdf('uploadHint')}</p>
              <p className="mt-2 text-[11px] text-warning bg-warning/10 border border-warning/20 rounded-lg px-3 py-2">
                {tPdf('layoutNotice')}
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
                title="Datei wird übersetzt"
                description="Textsegmente werden aus der Datei gelesen, übersetzt und in das ursprüngliche Format zurückgeschrieben (bei PDFs wird ein neues PDF gerendert)."
                steps={[{ key: 'file-translation', label: 'Texte übersetzen' }]}
                activeStep={0}
                done={false}
                startedAt={loadingStartedAt}
                etaSeconds={30}
                messages={translationMessages}
              />
            )}

            {officeResult && (
              <div className="bg-success/10 border border-success/20 text-success rounded-2xl p-4 text-sm">
                Datei erstellt: {officeResult.filename}
                {officeResult.warningCount > 0 ? ` (${officeResult.warningCount} mögliche Layout-Hinweise wegen längerer Übersetzungen)` : ''}
                {officeResult.isPdf ? ' — Layout wurde aus dem Originaltext neu aufgebaut.' : ''}
              </div>
            )}

            <button
              type="submit"
              disabled={officeLoading || !officeFile}
              className="w-full max-w-md gradient-accent text-white py-4 rounded-2xl text-lg font-bold shadow-lg shadow-accent/20 disabled:opacity-30 transition-all"
            >
              {officeLoading ? 'Datei wird übersetzt...' : 'Datei übersetzen'}
            </button>
          </form>
        ) : (
          <div className="space-y-6">
            {/* Top toolbar: Language + Translate button (above the panels) */}
            <div className="bg-surface border border-subtle rounded-2xl px-4 py-3 shadow-md flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <span className="text-xs font-bold text-secondary uppercase tracking-widest whitespace-nowrap">{t('to')}:</span>
                <select
                  value={targetLanguage}
                  onChange={(e) => setTargetLanguage(e.target.value)}
                  className="flex-1 sm:flex-none bg-hover-subtle border border-subtle text-accent font-bold text-sm rounded-xl px-4 py-2 outline-none hover:bg-hover-strong transition-all cursor-pointer"
                >
                  {LANGUAGES.map(lang => <option key={lang.code} value={lang.code}>{lang.label}</option>)}
                </select>
                <button
                  type="button"
                  onClick={() => setShowAdvancedOptions((prev) => !prev)}
                  className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-xl border border-subtle bg-hover-subtle text-xs text-secondary hover:text-primary transition-colors"
                  aria-expanded={showAdvancedOptions}
                >
                  <span>Optionen</span>
                  <svg className={`w-3.5 h-3.5 transition-transform ${showAdvancedOptions ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
              <button
                onClick={handleTranslate}
                disabled={loading || ocrLoading || !text.trim()}
                className="gradient-accent text-white px-8 py-3 rounded-xl text-sm font-bold shadow-lg shadow-accent/20 hover:shadow-accent/40 disabled:opacity-30 transition-all whitespace-nowrap"
              >
                {loading ? t('translating') : t('translate')}
              </button>
            </div>

            {showAdvancedOptions && (
              <div className="bg-surface border border-subtle rounded-2xl px-4 py-3 shadow">
                <label className="text-[10px] font-bold text-secondary uppercase tracking-widest opacity-60">Modell</label>
                <select value={model} onChange={e => setModel(e.target.value)} className="mt-2 w-full max-w-md bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-sm text-primary focus:ring-1 focus:ring-accent outline-none">
                  <option value="mistral-small-latest">Kostengünstig / Schnell</option>
                  <option value="mistral-medium-latest">Ausgewogen</option>
                  <option value="mistral-large-latest">Qualität</option>
                </select>
              </div>
            )}

            {/* Mobile tab switcher */}
            <div className="md:hidden inline-flex rounded-xl border border-subtle bg-surface p-1 w-full">
              <button
                type="button"
                onClick={() => setMobileTab('source')}
                className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                  mobileTab === 'source' ? 'bg-accent text-white' : 'text-secondary'
                }`}
              >
                {t('mobileSourceTab')}
              </button>
              <button
                type="button"
                onClick={() => setMobileTab('result')}
                className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                  mobileTab === 'result' ? 'bg-accent text-white' : 'text-secondary'
                }`}
              >
                {t('mobileResultTab')}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Source panel */}
              <div className={`space-y-3 ${mobileTab === 'source' ? '' : 'hidden md:block'}`}>
                <div className="flex items-center justify-between px-1 min-h-[36px]">
                  <span className="text-xs font-bold text-secondary uppercase tracking-wider">
                    {t('sourceHeading')}
                  </span>
                  <div className="flex items-center gap-2">
                    <input type="file" ref={fileInputRef} onChange={e => handleOcr(e.target.files[0])} accept=".pdf,image/*" className="hidden" />
                    <input type="file" ref={cameraInputRef} onChange={e => handleOcr(e.target.files[0])} accept="image/*" capture="environment" className="hidden" />

                    <button type="button" onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 bg-hover-subtle hover:bg-hover-strong text-primary px-3 py-1.5 rounded-xl text-xs font-bold border border-subtle transition-all" title="Dokument hochladen" aria-label="Dokument für OCR hochladen">
                      <svg className="w-4 h-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      <span className="hidden sm:inline">Dokument</span>
                    </button>
                    <button type="button" onClick={() => cameraInputRef.current?.click()} className="flex items-center gap-2 bg-hover-subtle hover:bg-hover-strong text-primary px-3 py-1.5 rounded-xl text-xs font-bold border border-subtle transition-all" title="Foto machen" aria-label="Foto aufnehmen und OCR starten">
                      <svg className="w-4 h-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                      <span className="hidden sm:inline">Kamera</span>
                    </button>
                    <button type="button" onClick={() => updateSourceText('')} className="p-2 text-secondary hover:text-danger bg-hover-subtle rounded-xl transition-colors" aria-label="Eingabetext leeren">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                  </div>
                </div>

                <div className={`bg-surface border border-subtle rounded-2xl overflow-hidden focus-within:border-accent/30 transition-all shadow-xl relative ${ocrLoading ? 'opacity-50' : ''}`}>
                  {ocrLoading && (
                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-overlay backdrop-blur-sm">
                      <div className="w-10 h-10 border-2 border-accent border-t-transparent rounded-full animate-spin mb-3" />
                      <span className="text-xs font-bold text-accent uppercase tracking-widest">Extrahiere Text...</span>
                    </div>
                  )}
                  <textarea value={text} onChange={(e) => updateSourceText(e.target.value)} placeholder={t('inputPlaceholder')} className="w-full min-h-[280px] bg-transparent p-6 text-primary placeholder-text-secondary/30 outline-none resize-y text-base leading-relaxed custom-scrollbar" />
                </div>
              </div>

              {/* Result panel */}
              <div className={`space-y-3 ${mobileTab === 'result' ? '' : 'hidden md:block'}`}>
                <div className="flex items-center justify-between px-1 min-h-[36px]">
                  <span className="text-xs font-bold text-secondary uppercase tracking-wider">
                    {t('resultHeading')}
                  </span>
                  {translatedText && (
                    <button
                      type="button"
                      onClick={() => setEditorOpen(true)}
                      className="flex items-center gap-1.5 bg-hover-subtle hover:bg-hover-strong text-primary px-3 py-1.5 rounded-xl text-xs font-bold border border-subtle transition-all"
                    >
                      <svg className="w-4 h-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                      {t('openInEditor')}
                    </button>
                  )}
                </div>

                <div className={`bg-surface border border-subtle rounded-2xl overflow-hidden shadow-xl relative ${loading ? 'opacity-50' : ''}`}>
                  {loading && (
                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-overlay backdrop-blur-sm">
                      <div className="w-10 h-10 border-2 border-accent border-t-transparent rounded-full animate-spin mb-3" />
                      <span className="text-xs font-bold text-accent uppercase tracking-widest">Übersetze...</span>
                    </div>
                  )}
                  {translatedText && !loading && (
                    <button
                      type="button"
                      onClick={handleCopyTranslation}
                      className={`absolute top-3 right-3 z-20 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition-all ${
                        copyFeedback
                          ? 'bg-success/20 border-success/40 text-success'
                          : 'bg-surface-elevated/95 backdrop-blur-sm border-subtle text-secondary hover:text-primary hover:border-accent/40'
                      }`}
                      title={copyFeedback ? t('copied') : t('copy')}
                      aria-label={copyFeedback ? t('copied') : t('copy')}
                    >
                      {copyFeedback ? (
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                      ) : (
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                      )}
                      <span>{copyFeedback ? t('copied') : t('copy')}</span>
                    </button>
                  )}
                  {translatedText ? (
                    <div
                      className="w-full min-h-[280px] bg-transparent p-6 text-primary text-base leading-relaxed custom-scrollbar overflow-y-auto prose prose-invert max-w-none dark:prose-invert"
                      // eslint-disable-next-line react/no-danger
                      dangerouslySetInnerHTML={{ __html: mdToHtml(translatedText) }}
                    />
                  ) : (
                    <div className="w-full min-h-[280px] flex items-center justify-center p-6 text-center text-secondary text-sm">
                      {t('resultPlaceholder')}
                    </div>
                  )}
                </div>
              </div>
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
                messages={ocrLoading ? translateOcrMessages : translationMessages}
              />
            )}
          </div>
        )}
      </div>

      {error && <div className="mt-8 p-4 bg-danger/10 border border-danger/20 text-danger rounded-2xl text-sm text-center animate-fade-in shadow-xl mx-auto max-w-5xl">{error}</div>}
    </>
  );
}
