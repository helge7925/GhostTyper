import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import AudioUploadForm from './AudioUploadForm';
import LoadingSpinner from './LoadingSpinner';
import { useTranslations } from '../lib/i18n';

export default function KnowledgePrepWorkspace({
  fixedMode = null,
  heading,
  showModeSelector = true,
}) {
  const t = useTranslations('knowledgePrep');
  const { data: session, status } = useSession();
  const router = useRouter();

  const MODE_OPTIONS = useMemo(
    () => [
      {
        value: 'data_table',
        label: t('modes.dataTable.label'),
        description: t('modes.dataTable.description'),
      },
    ],
    [t]
  );

  const SOURCE_OPTIONS = useMemo(
    () => [
      { value: 'audio', label: t('sources.audio') },
      { value: 'text', label: t('sources.text') },
      { value: 'document', label: t('sources.document') },
    ],
    [t]
  );

  const MODEL_OPTIONS = useMemo(
    () => [
      { value: 'mistral-small-latest', label: t('models.fast') },
      { value: 'mistral-medium-latest', label: t('models.balanced') },
      { value: 'mistral-large-latest', label: t('models.quality') },
    ],
    [t]
  );

  const resolvedHeading = heading || t('defaultHeading');

  const [mode, setMode] = useState(fixedMode || 'data_table');
  const effectiveMode = fixedMode || mode;
  const [source, setSource] = useState('audio');
  const [error, setError] = useState('');

  const [audioStarting, setAudioStarting] = useState(false);

  const [textInput, setTextInput] = useState('');
  const [textModel, setTextModel] = useState('mistral-large-latest');
  const [textPrompt, setTextPrompt] = useState('');
  const [textAnalysisFocus, setTextAnalysisFocus] = useState('');
  const [textSubmitting, setTextSubmitting] = useState(false);

  const [documentFile, setDocumentFile] = useState(null);
  const [documentModel, setDocumentModel] = useState('mistral-large-latest');
  const [documentPrompt, setDocumentPrompt] = useState('');
  const [documentAnalysisFocus, setDocumentAnalysisFocus] = useState('');
  const [documentScope, setDocumentScope] = useState('');
  const [documentSubmitting, setDocumentSubmitting] = useState(false);
  const documentInputRef = useRef(null);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  useEffect(() => {
    if (!fixedMode) return;
    setMode(fixedMode);
  }, [fixedMode]);

  const modeMeta = useMemo(
    () => MODE_OPTIONS.find((entry) => entry.value === effectiveMode) || MODE_OPTIONS[0],
    [effectiveMode, MODE_OPTIONS]
  );

  const availableSourceOptions = SOURCE_OPTIONS;

  async function handleAudioSuccess(uploadResult) {
    if (!uploadResult?.id) return;
    setError('');
    setAudioStarting(true);
    try {
      const response = await fetch(`/api/transcriptions/${uploadResult.id}/process`, {
        method: 'POST',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message || t('audio.processStartFailed'));
      }
      router.push(`/transcriptions/${uploadResult.id}`);
    } catch (err) {
      setError(err.message || t('audio.audioProcessFailed'));
    } finally {
      setAudioStarting(false);
    }
  }

  async function handleTextSubmit(event) {
    event.preventDefault();
    const trimmedText = textInput.trim();
    if (!trimmedText) {
      setError(t('text.missingText'));
      return;
    }

    setError('');
    setTextSubmitting(true);
    try {
      const response = await fetch('/api/knowledge-prep/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template: effectiveMode,
          text: trimmedText,
          model: textModel,
          customPrompt: textPrompt,
          analysisFocus: textAnalysisFocus,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message || t('text.processFailed'));
      }
      router.push(`/transcriptions/${payload.id}`);
    } catch (err) {
      setError(err.message || t('text.processFailed'));
    } finally {
      setTextSubmitting(false);
    }
  }

  async function handleDocumentSubmit(event) {
    event.preventDefault();
    if (!documentFile) {
      setError(t('document.missingFile'));
      return;
    }

    setError('');
    setDocumentSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('file', documentFile);
      formData.append('analyze', 'true');
      formData.append('template', effectiveMode);
      formData.append('model', documentModel);
      const mergedPrompt = documentPrompt.trim();
      if (mergedPrompt) {
        formData.append('customPrompt', mergedPrompt);
      }
      if (documentAnalysisFocus.trim()) {
        formData.append('analysisFocus', documentAnalysisFocus.trim());
      }
      if (documentScope.trim()) {
        formData.append('documentScope', documentScope.trim());
      }

      const response = await fetch('/api/ocr', {
        method: 'POST',
        body: formData,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message || t('document.processFailed'));
      }
      router.push(`/transcriptions/${payload.transcriptionId}`);
    } catch (err) {
      setError(err.message || t('document.processFailed'));
    } finally {
      setDocumentSubmitting(false);
    }
  }

  function handleDocumentPick(file) {
    setError('');
    setDocumentFile(file || null);
  }

  if (status === 'loading' || !session) return <LoadingSpinner />;

  return (
    <div className="max-w-5xl mx-auto animate-fade-in pb-20 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-primary">{resolvedHeading}</h1>
        <p className="text-sm text-secondary mt-1">
          {modeMeta.label}: {modeMeta.description}
        </p>
      </div>

      {!fixedMode && showModeSelector && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {MODE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setMode(option.value)}
              className={`text-left rounded-2xl border p-4 transition-colors ${
                effectiveMode === option.value
                  ? 'border-info/40 bg-cyan-500/10'
                  : 'border-subtle bg-hover-subtle hover:bg-hover-subtle'
              }`}
            >
              <p className="text-sm font-semibold text-primary">{option.label}</p>
              <p className="text-xs text-secondary mt-1">{option.description}</p>
            </button>
          ))}
        </div>
      )}

      <div className="bg-surface border border-subtle rounded-2xl p-2 inline-flex gap-2">
        {availableSourceOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setSource(option.value)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
              source === option.value
                ? 'bg-accent/20 text-accent border border-accent/30'
                : 'text-secondary hover:text-primary'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {source === 'audio' && (
        <div className="bg-surface border border-subtle rounded-2xl p-6">
          <h2 className="text-sm font-semibold text-primary mb-2">{t('audio.heading')}</h2>
          <p className="text-xs text-secondary mb-4">
            {t('audio.subtext')}
          </p>
          <AudioUploadForm
            key={`audio-${effectiveMode}`}
            onSuccess={handleAudioSuccess}
            lockTemplate
            templateLabel={modeMeta.label}
            presetConfig={{
              uploadMode: 'file',
              autoAnalyze: true,
              diarize: false,
              template: effectiveMode,
              model: 'mistral-large-latest',
            }}
          />
          {audioStarting && (
            <p className="text-xs text-info mt-3">{t('audio.starting')}</p>
          )}
        </div>
      )}

      {source === 'text' && (
        <form onSubmit={handleTextSubmit} className="bg-surface border border-subtle rounded-2xl p-6 space-y-4">
          <h2 className="text-sm font-semibold text-primary">{t('text.heading')}</h2>
          <textarea
            value={textInput}
            onChange={(event) => setTextInput(event.target.value)}
            placeholder={t('text.placeholder')}
            rows={10}
            className="w-full bg-surface-elevated border border-subtle rounded-xl px-4 py-3 text-sm text-primary outline-none resize-y"
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-secondary mb-1.5">{t('text.model')}</label>
              <select
                value={textModel}
                onChange={(event) => setTextModel(event.target.value)}
                className="w-full bg-surface-elevated border border-subtle rounded-xl px-3 py-2 text-sm text-primary outline-none"
              >
                {MODEL_OPTIONS.map((entry) => (
                  <option key={entry.value} value={entry.value}>{entry.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary mb-1.5">{t('text.context')}</label>
              <input
                value={textPrompt}
                onChange={(event) => setTextPrompt(event.target.value)}
                placeholder={t('text.contextPlaceholder')}
                className="w-full bg-surface-elevated border border-subtle rounded-xl px-3 py-2 text-sm text-primary outline-none"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-secondary mb-1.5">{t('text.focus')}</label>
              <textarea
                value={textAnalysisFocus}
                onChange={(event) => setTextAnalysisFocus(event.target.value)}
                placeholder={t('text.focusPlaceholder')}
                rows={2}
                className="w-full bg-surface-elevated border border-subtle rounded-xl px-3 py-2 text-sm text-primary outline-none resize-y"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={textSubmitting}
            className="gradient-accent text-white px-5 py-2.5 rounded-xl text-sm font-semibold shadow-lg shadow-accent/20 disabled:opacity-40"
          >
            {textSubmitting ? t('text.submitting') : t('text.submit', { label: modeMeta.label })}
          </button>
        </form>
      )}

      {source === 'document' && (
        <form onSubmit={handleDocumentSubmit} className="bg-surface border border-subtle rounded-2xl p-6 space-y-4">
          <h2 className="text-sm font-semibold text-primary">{t('document.heading')}</h2>
          <div
            role="button"
            tabIndex={0}
            onClick={() => documentInputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                documentInputRef.current?.click();
              }
            }}
            className="border-2 border-dashed border-emphasis hover:border-emphasis rounded-2xl p-6 text-center cursor-pointer transition-colors"
          >
            <input
              ref={documentInputRef}
              type="file"
              accept=".pdf,image/*"
              onChange={(event) => handleDocumentPick(event.target.files?.[0] || null)}
              className="hidden"
            />
            {documentFile ? (
              <p className="text-sm text-primary">
                {documentFile.name}{' '}
                <span className="text-secondary">({(documentFile.size / 1024 / 1024).toFixed(1)} MB)</span>
              </p>
            ) : (
              <p className="text-sm text-secondary">{t('document.pickFile')}</p>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-secondary mb-1.5">{t('document.model')}</label>
              <select
                value={documentModel}
                onChange={(event) => setDocumentModel(event.target.value)}
                className="w-full bg-surface-elevated border border-subtle rounded-xl px-3 py-2 text-sm text-primary outline-none"
              >
                {MODEL_OPTIONS.map((entry) => (
                  <option key={entry.value} value={entry.value}>{entry.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary mb-1.5">{t('document.context')}</label>
              <input
                value={documentPrompt}
                onChange={(event) => setDocumentPrompt(event.target.value)}
                placeholder={t('document.contextPlaceholder')}
                className="w-full bg-surface-elevated border border-subtle rounded-xl px-3 py-2 text-sm text-primary outline-none"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-secondary mb-1.5">{t('document.focus')}</label>
              <textarea
                value={documentAnalysisFocus}
                onChange={(event) => setDocumentAnalysisFocus(event.target.value)}
                placeholder={t('document.focusPlaceholder')}
                rows={2}
                className="w-full bg-surface-elevated border border-subtle rounded-xl px-3 py-2 text-sm text-primary outline-none resize-y"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-secondary mb-1.5">{t('document.scope')}</label>
            <textarea
              value={documentScope}
              onChange={(event) => setDocumentScope(event.target.value)}
              placeholder={t('document.scopePlaceholder')}
              rows={2}
              className="w-full bg-surface-elevated border border-subtle rounded-xl px-3 py-2 text-sm text-primary outline-none resize-y"
            />
          </div>
          <button
            type="submit"
            disabled={documentSubmitting}
            className="gradient-accent text-white px-5 py-2.5 rounded-xl text-sm font-semibold shadow-lg shadow-accent/20 disabled:opacity-40"
          >
            {documentSubmitting ? t('document.submitting') : t('document.submit', { label: modeMeta.label })}
          </button>
        </form>
      )}

      {error && (
        <div className="bg-danger/10 border border-danger/25 text-danger rounded-2xl px-4 py-3 text-sm">
          {error}
        </div>
      )}
    </div>
  );
}
