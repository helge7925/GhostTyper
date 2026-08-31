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
import { useModelOptions } from '../lib/use-model-options';
import { usePermission } from '../lib/use-permission';
import TranslationTermPanel from '../components/TranslationTermPanel';
import { Button } from '../components/ui/button';
import { Card, CardBody } from '../components/ui/card';
import { Field } from '../components/ui/field';
import { Camera, Check, ChevronDown, Copy, FileText, Pencil, Trash2, Upload } from 'lucide-react';
import { cn } from '../lib/utils';
import { alignBilingualText } from '../lib/bilingual-export';

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
  const canManageWorkspace = usePermission('org.settings');

  const [text, setText] = useState('');
  const [targetLanguage, setTargetLanguage] = useState('German');
  const [model, setModel] = useState('');
  const { options: chatModelOptions, defaultModel } = useModelOptions('chat');
  useEffect(() => { if (!model && defaultModel) setModel(defaultModel); }, [defaultModel, model]);
  const [translatedText, setTranslatedText] = useState('');
  const [glossaryMeta, setGlossaryMeta] = useState(null);
  const [translatedSource, setTranslatedSource] = useState('');
  const [officeGlossaryMeta, setOfficeGlossaryMeta] = useState(null);
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
  const [bilingualExportLoading, setBilingualExportLoading] = useState('');

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
      setGlossaryMeta(data.glossary || null);
      setTranslatedSource(text);
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
    setOfficeGlossaryMeta(null);
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
      const glossaryHeader = response.headers.get('x-ghosttyper-glossary');
      if (glossaryHeader) {
        try {
          setOfficeGlossaryMeta(JSON.parse(decodeURIComponent(glossaryHeader)));
        } catch {
          setOfficeGlossaryMeta(null);
        }
      }
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

  async function handleBilingualExport(format) {
    if (!translatedSource || !translatedText || bilingualExportLoading) return;
    setBilingualExportLoading(format);
    setError('');
    try {
      const response = await fetch('/api/translate/file-bilingual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pairs: alignBilingualText(translatedSource, translatedText),
          format,
          title: t('bilingualTitle'),
          sourceLabel: t('sourceHeading'),
          targetLabel: t('resultHeading'),
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || t('bilingualExportError'));
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `bilingual-translation.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(err.message || t('bilingualExportError'));
    } finally {
      setBilingualExportLoading('');
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

      <div className="max-w-6xl mx-auto pb-20 animate-fade-in">
        <header className="mb-7">
          <p className="text-xs font-medium text-secondary mb-2">{t('eyebrow')}</p>
          <h1 className="text-3xl font-semibold tracking-tight text-primary">{t('title')}</h1>
          <p className="text-sm leading-6 text-secondary mt-2 max-w-2xl">{t('subtitle')}</p>
        </header>

        <div className="mb-6 inline-flex rounded-xl border border-subtle bg-surface-elevated p-1">
          <button
            type="button"
            onClick={() => setMode('text')}
            className={`min-h-10 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
              mode === 'text' ? 'bg-surface border-subtle text-primary' : 'border-transparent text-secondary hover:text-primary'
            }`}
          >
            {t('tabText')}
          </button>
          <button
            type="button"
            onClick={() => setMode('office')}
            className={`min-h-10 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
              mode === 'office' ? 'bg-surface border-subtle text-primary' : 'border-transparent text-secondary hover:text-primary'
            }`}
          >
            {t('tabFile')}
          </button>
        </div>

        {mode === 'office' ? (
          <form onSubmit={handleOfficeTranslate} className="space-y-5 max-w-3xl">
            <Card>
              <CardBody className="p-5 sm:p-6">
              <Field label={t('fileLabel')} htmlFor="office-translation-file" help={tPdf('uploadHint')}>
              <input
                id="office-translation-file"
                type="file"
                accept=".pdf,.docx,.xlsx,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                onChange={(event) => setOfficeFile(event.target.files?.[0] || null)}
                className="block w-full rounded-lg border border-dashed border-emphasis bg-surface-elevated/40 p-4 text-sm text-secondary file:mr-4 file:rounded-lg file:border file:border-subtle file:bg-surface file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary hover:file:bg-hover-subtle"
              />
              </Field>
              <p className="mt-4 text-xs text-warning border-l-2 border-warning/50 pl-3">
                {tPdf('layoutNotice')}
              </p>
              </CardBody>
            </Card>

            <Card>
              <CardBody className="p-5 sm:p-6 space-y-4">
              <Field label={t('targetLanguage')} htmlFor="office-target-language" help={t('targetLanguageHint')}>
                <select
                  id="office-target-language"
                  value={targetLanguage}
                  onChange={(event) => setTargetLanguage(event.target.value)}
                  className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2.5 text-sm text-primary outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
                >
                  {LANGUAGES.map(lang => <option key={lang.code} value={lang.code}>{lang.label}</option>)}
                </select>
              </Field>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowAdvancedOptions((prev) => !prev)}
                className="w-full justify-between px-3"
                aria-expanded={showAdvancedOptions}
              >
                <span>{t('details')}</span>
                <ChevronDown className={cn('w-4 h-4 transition-transform', showAdvancedOptions && 'rotate-180')} aria-hidden="true" />
              </Button>
              {showAdvancedOptions && (
                <Field label={t('modelLabel')} htmlFor="office-model" help={t('modelHint')}>
                <select
                  id="office-model"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2.5 text-sm text-primary outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
                >
                  {chatModelOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                </Field>
              )}
              </CardBody>
            </Card>

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
              <div className="border border-success/30 text-success rounded-xl p-4 text-sm">
                Datei erstellt: {officeResult.filename}
                {officeResult.warningCount > 0 ? ` (${officeResult.warningCount} mögliche Layout-Hinweise wegen längerer Übersetzungen)` : ''}
                {officeResult.isPdf ? ' — Layout wurde aus dem Originaltext neu aufgebaut.' : ''}
              </div>
            )}

            {officeGlossaryMeta && (
              <TranslationTermPanel
                meta={officeGlossaryMeta}
                canManageWorkspace={canManageWorkspace}
                onError={(message) => setError(message)}
              />
            )}

            <Button
              type="submit"
              disabled={officeLoading || !officeFile}
              variant="primary"
              size="lg"
              className="w-full"
            >
              <FileText className="w-4 h-4" aria-hidden="true" />
              {officeLoading ? t('fileTranslating') : t('fileTranslate')}
            </Button>
          </form>
        ) : (
          <div className="space-y-5">
            {/* Top toolbar: Language + Translate button (above the panels) */}
            <Card className="px-4 py-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <label htmlFor="text-target-language" className="text-xs font-medium text-secondary whitespace-nowrap">{t('to')}</label>
                <select
                  id="text-target-language"
                  value={targetLanguage}
                  onChange={(e) => setTargetLanguage(e.target.value)}
                  className="flex-1 sm:flex-none bg-surface-elevated border border-subtle text-primary font-medium text-sm rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent cursor-pointer"
                >
                  {LANGUAGES.map(lang => <option key={lang.code} value={lang.code}>{lang.label}</option>)}
                </select>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAdvancedOptions((prev) => !prev)}
                  className="inline-flex"
                  aria-expanded={showAdvancedOptions}
                >
                  <span>{t('details')}</span>
                  <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', showAdvancedOptions && 'rotate-180')} aria-hidden="true" />
                </Button>
              </div>
              <Button
                onClick={handleTranslate}
                disabled={loading || ocrLoading || !text.trim()}
                variant="primary"
                className="sm:min-w-36"
              >
                {loading ? t('translating') : t('translate')}
              </Button>
            </Card>

            {showAdvancedOptions && (
              <Card>
                <CardBody className="p-4">
                <Field label={t('modelLabel')} help={t('modelHint')} className="max-w-md">
                <select value={model} onChange={e => setModel(e.target.value)} className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-sm text-primary focus:ring-2 focus:ring-accent/30 focus:border-accent outline-none">
                  {chatModelOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                </Field>
                </CardBody>
              </Card>
            )}

            {/* Mobile tab switcher */}
            <div className="md:hidden inline-flex rounded-xl border border-subtle bg-surface-elevated p-1 w-full">
              <button
                type="button"
                onClick={() => setMobileTab('source')}
                className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                  mobileTab === 'source' ? 'bg-surface border border-subtle text-primary' : 'border border-transparent text-secondary'
                }`}
              >
                {t('mobileSourceTab')}
              </button>
              <button
                type="button"
                onClick={() => setMobileTab('result')}
                className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                  mobileTab === 'result' ? 'bg-surface border border-subtle text-primary' : 'border border-transparent text-secondary'
                }`}
              >
                {t('mobileResultTab')}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Source panel */}
              <div className={`space-y-3 ${mobileTab === 'source' ? '' : 'hidden md:block'}`}>
                <div className="flex items-center justify-between px-1 min-h-[36px]">
                  <span className="text-xs font-medium text-secondary">
                    {t('sourceHeading')}
                  </span>
                  <div className="flex items-center gap-2">
                    <input type="file" ref={fileInputRef} onChange={e => handleOcr(e.target.files[0])} accept=".pdf,image/*" className="hidden" />
                    <input type="file" ref={cameraInputRef} onChange={e => handleOcr(e.target.files[0])} accept="image/*" capture="environment" className="hidden" />

                    <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} title={t('uploadDocument')} aria-label={t('uploadDocument')}>
                      <Upload className="w-4 h-4" aria-hidden="true" />
                      <span className="hidden sm:inline">Dokument</span>
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => cameraInputRef.current?.click()} title={t('takePhoto')} aria-label={t('takePhoto')}>
                      <Camera className="w-4 h-4" aria-hidden="true" />
                      <span className="hidden sm:inline">Kamera</span>
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => updateSourceText('')} aria-label={t('clearInput')}>
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>

                <div className={`bg-surface border border-subtle rounded-xl overflow-hidden focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20 transition-colors relative ${ocrLoading ? 'opacity-50' : ''}`}>
                  {ocrLoading && (
                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-overlay backdrop-blur-sm">
                      <div className="w-10 h-10 border-2 border-accent border-t-transparent rounded-full animate-spin mb-3" />
                      <span className="text-xs font-medium text-primary">{t('extractingText')}</span>
                    </div>
                  )}
                  <textarea value={text} onChange={(e) => updateSourceText(e.target.value)} placeholder={t('inputPlaceholder')} className="w-full min-h-[280px] bg-transparent p-6 text-primary placeholder-text-secondary/30 outline-none resize-y text-base leading-relaxed custom-scrollbar" />
                </div>
              </div>

              {/* Result panel */}
              <div className={`space-y-3 ${mobileTab === 'result' ? '' : 'hidden md:block'}`}>
                <div className="flex items-center justify-between px-1 min-h-[36px]">
                  <span className="text-xs font-medium text-secondary">
                    {t('resultHeading')}
                  </span>
                  {translatedText && (
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!!bilingualExportLoading}
                        onClick={() => handleBilingualExport('html')}
                      >
                        {bilingualExportLoading === 'html' ? '…' : t('bilingualHtml')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!!bilingualExportLoading}
                        onClick={() => handleBilingualExport('pdf')}
                      >
                        {bilingualExportLoading === 'pdf' ? '…' : t('bilingualPdf')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setEditorOpen(true)}
                      >
                        <Pencil className="w-4 h-4" aria-hidden="true" />
                        {t('openInEditor')}
                      </Button>
                    </div>
                  )}
                </div>

                <div className={`bg-surface border border-subtle rounded-xl overflow-hidden relative ${loading ? 'opacity-50' : ''}`}>
                  {loading && (
                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-overlay backdrop-blur-sm">
                      <div className="w-10 h-10 border-2 border-accent border-t-transparent rounded-full animate-spin mb-3" />
                      <span className="text-xs font-medium text-primary">{t('translating')}</span>
                    </div>
                  )}
                  {translatedText && !loading && (
                    <button
                      type="button"
                      onClick={handleCopyTranslation}
                      className={`absolute top-3 right-3 z-20 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        copyFeedback
                          ? 'bg-success/20 border-success/40 text-success'
                          : 'bg-surface-elevated/95 backdrop-blur-sm border-subtle text-secondary hover:text-primary hover:border-accent/40'
                      }`}
                      title={copyFeedback ? t('copied') : t('copy')}
                      aria-label={copyFeedback ? t('copied') : t('copy')}
                    >
                      {copyFeedback ? (
                        <Check className="w-3.5 h-3.5" aria-hidden="true" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" aria-hidden="true" />
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

            {translatedText && !loading && glossaryMeta && (
              <TranslationTermPanel
                meta={glossaryMeta}
                sourceText={translatedSource}
                canManageWorkspace={canManageWorkspace}
                onError={(message) => setError(message)}
              />
            )}

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

      {error && <div role="alert" className="mt-8 p-4 border border-danger/30 text-danger rounded-xl text-sm text-center animate-fade-in mx-auto max-w-5xl">{error}</div>}
    </>
  );
}
