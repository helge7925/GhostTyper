import { useState, useRef, useEffect } from 'react';
import { Check, ChevronDown, FileAudio, Mic, MonitorSpeaker, Upload, X } from 'lucide-react';
import { CHAT_MODEL_OPTIONS, CHAT_MODELS, ACCEPTED_AUDIO_TYPES, MAX_FILE_SIZE, normalizeDefaultTemplate } from '../lib/constants';
import { uploadAudio, getTemplates, getSettings } from '../lib/api';
import AudioRecorder from './AudioRecorder';
import SystemAudioRecorder from './SystemAudioRecorder';
import { getSystemAudioCapabilities } from '../lib/audio-utils';
import { useTranslations } from '../lib/i18n';
import { Button } from './ui/button';
import { Field } from './ui/field';
import { cn } from '../lib/utils';

// `aufmass` is intentionally absent from the user-facing offering but
// remains accepted by the backend (see lib/template-service.js) so legacy
// DB rows still resolve.
const BUILTIN_TEMPLATE_VALUES = new Set(['generic', 'meeting', 'action_items', 'data_table', 'aufmass']);
const ALLOWED_CHAT_MODELS = new Set(CHAT_MODELS);
const ALLOWED_UPLOAD_MODES = new Set(['file', 'record', 'system-audio']);

function resolvePresetTemplate(templateValue, templates) {
  const raw = String(templateValue || '').trim();
  if (!raw) return null;
  if (BUILTIN_TEMPLATE_VALUES.has(raw)) return raw;
  if (!raw.startsWith('custom-')) return null;
  const customId = raw.slice('custom-'.length);
  return templates.some((entry) => String(entry.id) === customId) ? raw : null;
}

export default function AudioUploadForm({ onSuccess, presetConfig = null, lockTemplate = false, templateLabel = '' }) {
  const t = useTranslations('upload');
  const tForm = useTranslations('components.uploadForm');
  const [file, setFile] = useState(null);
  const [template, setTemplate] = useState('generic');
  const [model, setModel] = useState('deepseek-v4-pro');
  const [templates, setTemplates] = useState([]);
  const [diarize, setDiarize] = useState(false);
  const [autoAnalyze, setAutoAnalyze] = useState(true);
  const [customPrompt, setCustomPrompt] = useState('');
  const [analysisFocus, setAnalysisFocus] = useState('');
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [uploadMode, setUploadMode] = useState('file');
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [systemAudioCaps, setSystemAudioCaps] = useState({ tabAudio: false, systemAudio: false });
  const inputRef = useRef(null);
  const textTemplates = templates.filter((entry) => !entry.template_type || entry.template_type === 'text');
  const showSystemAudioTab = systemAudioCaps.tabAudio;

  useEffect(() => {
    setSystemAudioCaps(getSystemAudioCapabilities());
  }, []);

  useEffect(() => {
    if (uploadMode === 'system-audio' && !showSystemAudioTab) {
      setUploadMode('record');
    }
  }, [uploadMode, showSystemAudioTab]);

  useEffect(() => {
    // Load custom templates and default settings
    Promise.all([getTemplates(), getSettings()])
      .then(([templatesData, settingsData]) => {
        setTemplates(templatesData);
        let nextTemplate = normalizeDefaultTemplate(settingsData.defaultTemplate);
        const presetTemplate = resolvePresetTemplate(presetConfig?.template, templatesData || []);
        if (presetTemplate) {
          nextTemplate = presetTemplate;
        }
        setTemplate(nextTemplate);
        if (ALLOWED_CHAT_MODELS.has(presetConfig?.model)) {
          setModel(presetConfig.model);
        }
        if (ALLOWED_UPLOAD_MODES.has(presetConfig?.uploadMode)) {
          setUploadMode(presetConfig.uploadMode);
        }
        if (typeof presetConfig?.autoAnalyze === 'boolean') {
          setAutoAnalyze(presetConfig.autoAnalyze);
        }
        if (typeof presetConfig?.diarize === 'boolean') {
          setDiarize(presetConfig.diarize);
        }
        if (typeof presetConfig?.customPrompt === 'string') {
          setCustomPrompt(presetConfig.customPrompt);
        }
        if (typeof presetConfig?.analysisFocus === 'string') {
          setAnalysisFocus(presetConfig.analysisFocus);
        }
        if (presetConfig?.showAdvancedOptions) {
          setShowAdvancedOptions(true);
        }
      })
      .catch(err => console.error('Error loading upload options:', err));
  }, [presetConfig]);

  useEffect(() => {
    if (!presetConfig) return;
    const presetTemplate = resolvePresetTemplate(presetConfig.template, templates);
    if (presetTemplate) setTemplate(presetTemplate);
    if (ALLOWED_CHAT_MODELS.has(presetConfig.model)) setModel(presetConfig.model);
    if (ALLOWED_UPLOAD_MODES.has(presetConfig.uploadMode)) setUploadMode(presetConfig.uploadMode);
    if (typeof presetConfig.autoAnalyze === 'boolean') setAutoAnalyze(presetConfig.autoAnalyze);
    if (typeof presetConfig.diarize === 'boolean') setDiarize(presetConfig.diarize);
    if (typeof presetConfig.customPrompt === 'string') setCustomPrompt(presetConfig.customPrompt);
    if (typeof presetConfig.analysisFocus === 'string') setAnalysisFocus(presetConfig.analysisFocus);
    if (presetConfig.showAdvancedOptions) setShowAdvancedOptions(true);
  }, [presetConfig, templates]);

  function validateFile(f) {
    const type = f.type.split(';')[0];
    if (!ACCEPTED_AUDIO_TYPES.includes(type) && !type.startsWith('audio/')) {
      return 'Ungültiger Dateityp. Bitte laden Sie eine Audio-Datei hoch.';
    }
    if (f.size > MAX_FILE_SIZE) {
      return 'Die Datei ist zu groß. Maximale Größe: 500 MB.';
    }
    return null;
  }

  function handleFile(f) {
    setError(null);
    const err = validateFile(f);
    if (err) {
      setError(err);
      return;
    }
    setFile(f);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  }

  function handleFileZoneKeyDown(event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      inputRef.current?.click();
    }
  }

  function handleRecordingComplete(blob) {
    const extension = blob.type.includes('mp4') ? 'mp4' : 
                      blob.type.includes('webm') ? 'webm' : 
                      blob.type.includes('ogg') ? 'ogg' : 'webm';
    
    const recordedFile = new File([blob], `aufnahme-${Date.now()}.${extension}`, { type: blob.type });
    setFile(recordedFile);
    setUploadMode('file');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!file) return;

    setUploading(true);
    setError(null);
    setProgress(0);

    try {
      const progressInterval = setInterval(() => {
        setProgress((prev) => Math.min(prev + 10, 90));
      }, 200);

      const result = await uploadAudio(file, { template, model, diarize, customPrompt, analysisFocus, autoAnalyze });

      clearInterval(progressInterval);
      setProgress(100);
      setFile(null);
      if (onSuccess) onSuccess(result);
    } catch (err) {
      setError(err.message || 'Fehler beim Hochladen.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <fieldset>
        <legend className="text-xs font-medium text-secondary mb-2">{tForm('sourceLabel')}</legend>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 p-1 rounded-xl bg-surface-elevated border border-subtle">
          {[
            { mode: 'file', label: tForm('tabUpload'), Icon: Upload, show: true },
            { mode: 'record', label: tForm('tabRecord'), Icon: Mic, show: true },
            { mode: 'system-audio', label: tForm('tabSystemAudio'), Icon: MonitorSpeaker, show: showSystemAudioTab },
          ].filter((tab) => tab.show).map(({ mode, label, Icon }) => {
            const active = uploadMode === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => setUploadMode(mode)}
                aria-pressed={active}
                className={cn(
                  'min-h-10 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  active
                    ? 'bg-surface text-primary border-subtle'
                    : 'border-transparent text-secondary hover:text-primary hover:bg-hover-subtle',
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {uploadMode === 'file' ? (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onClick={() => {
            if (!file) inputRef.current?.click();
          }}
          onKeyDown={file ? undefined : handleFileZoneKeyDown}
          role={file ? 'group' : 'button'}
          tabIndex={file ? undefined : 0}
          aria-label={tForm('dragOrClick')}
          className={`border border-dashed rounded-xl p-8 sm:p-10 text-center cursor-pointer outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent ${
            dragActive
              ? 'border-accent bg-accent/5'
              : 'border-emphasis bg-surface-elevated/40 hover:border-accent/60 hover:bg-surface-elevated'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept="audio/*"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            className="hidden"
          />
          {file ? (
            <div className="flex items-center justify-center gap-3 text-left">
              <span className="h-10 w-10 rounded-lg bg-accent/10 text-accent-ink flex items-center justify-center shrink-0">
                <FileAudio className="w-5 h-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-primary truncate">{file.name}</p>
                <p className="text-xs text-secondary mt-0.5">
                  {(file.size / 1024 / 1024).toFixed(1)} MB
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => inputRef.current?.click()}
              >
                {tForm('replaceFile')}
              </Button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setFile(null);
                  if (inputRef.current) inputRef.current.value = '';
                }}
                className="h-9 w-9 rounded-lg text-secondary hover:text-danger hover:bg-danger/10 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                aria-label={tForm('removeFile')}
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <div>
              <span className="mx-auto mb-4 h-10 w-10 rounded-lg bg-surface border border-subtle text-secondary flex items-center justify-center">
                <Upload className="w-5 h-5" aria-hidden="true" />
              </span>
              <p className="text-sm font-medium text-primary">{tForm('selectFile')}</p>
              <p className="text-xs text-secondary mt-1">{tForm('dragHint')}</p>
              <p className="text-xs text-muted mt-3">{t('fileFormats')}</p>
            </div>
          )}
        </div>
      ) : uploadMode === 'system-audio' && showSystemAudioTab ? (
        <SystemAudioRecorder onRecordingComplete={handleRecordingComplete} />
      ) : (
        <AudioRecorder onRecordingComplete={handleRecordingComplete} />
      )}

      <fieldset className="border-t border-subtle pt-5">
        <legend className="sr-only">{tForm('outputLabel')}</legend>
        <p className="text-xs font-medium text-secondary mb-3">{tForm('outputLabel')}</p>
        <div className="grid sm:grid-cols-2 gap-2">
        <label className="flex items-start gap-3 cursor-pointer rounded-lg p-3 border border-subtle hover:bg-hover-subtle transition-colors">
          <input type="checkbox" checked={diarize} onChange={(e) => setDiarize(e.target.checked)} className="w-4 h-4 accent-accent bg-surface-elevated border-emphasis rounded focus:ring-accent" />
          <span>
            <span className="block text-sm font-medium text-primary">{t('diarize')}</span>
            <span className="block text-xs text-secondary mt-0.5">{tForm('diarizeHint')}</span>
          </span>
        </label>
        <label className="flex items-start gap-3 cursor-pointer rounded-lg p-3 border border-subtle hover:bg-hover-subtle transition-colors">
          <input type="checkbox" checked={autoAnalyze} onChange={(e) => setAutoAnalyze(e.target.checked)} className="w-4 h-4 accent-accent bg-surface-elevated border-emphasis rounded focus:ring-accent" />
          <span>
            <span className="block text-sm font-medium text-primary">{t('autoAnalyze')}</span>
            <span className="block text-xs text-secondary mt-0.5">{tForm('autoAnalyzeHint')}</span>
          </span>
        </label>
        </div>
      </fieldset>

      <div className="border-t border-subtle pt-4">
        <Button
          type="button"
          variant="ghost"
          onClick={() => setShowAdvancedOptions((prev) => !prev)}
          className="w-full justify-between px-3"
          aria-expanded={showAdvancedOptions}
        >
          <span>{tForm('advancedOptions')}</span>
          <ChevronDown className={cn('w-4 h-4 text-secondary transition-transform', showAdvancedOptions && 'rotate-180')} aria-hidden="true" />
        </Button>
      </div>

      {showAdvancedOptions && (
        <div className="space-y-4 bg-surface-elevated/50 border border-subtle rounded-xl p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {!lockTemplate ? (
              <Field label={tForm('analysisMode')} htmlFor="upload-template" help={tForm('analysisModeHint')}>
                <select id="upload-template" value={template} onChange={(e) => setTemplate(e.target.value)} className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-sm text-primary focus:ring-1 focus:ring-accent outline-none">
                  <optgroup label="Standard"><option value="generic">Zusammenfassung</option><option value="meeting">Meeting-Protokoll</option><option value="action_items">To-Dos extrahieren</option></optgroup>
                  {textTemplates.length > 0 && <optgroup label="Eigene Text-Vorlagen">{textTemplates.map(t => <option key={t.id} value={`custom-${t.id}`}>{t.name}</option>)}</optgroup>}
                </select>
              </Field>
            ) : (
              <Field label={tForm('analysisMode')} className="md:col-span-1">
                <div className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-sm text-primary">
                  {templateLabel || template}
                </div>
              </Field>
            )}
            <Field label={tForm('modelLabel')} htmlFor="upload-model" help={tForm('modelHint')}>
              <select id="upload-model" value={model} onChange={(e) => setModel(e.target.value)} className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-sm text-primary focus:ring-1 focus:ring-accent outline-none">
                {CHAT_MODEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label={t('additionalContext')} htmlFor="upload-prompt" help={tForm('contextHelp')}>
            <textarea id="upload-prompt" value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)} placeholder={t('additionalContextHint')} rows={2} className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-sm text-primary focus:ring-1 focus:ring-accent outline-none resize-none" />
          </Field>
          <Field label={t('analysisFocus')} htmlFor="upload-analysis-focus" help={tForm('focusHelp')}>
            <textarea
              id="upload-analysis-focus"
              value={analysisFocus}
              onChange={(e) => setAnalysisFocus(e.target.value)}
              placeholder={t('analysisFocus')}
              rows={2}
              className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-sm text-primary focus:ring-1 focus:ring-accent outline-none resize-none"
            />
          </Field>
        </div>
      )}

      {error && <div role="alert" className="border border-danger/30 text-danger px-4 py-3 rounded-lg text-sm">{error}</div>}

      {uploading && (
        <progress
          className="upload-progress w-full"
          value={Math.max(0, Math.min(progress, 100))}
          max={100}
        />
      )}

      <Button type="submit" disabled={!file || uploading} variant="primary" size="lg" className="w-full">
        {uploading ? t('submitting') : (
          <>
            <Check className="w-4 h-4" aria-hidden="true" />
            {t('submit')}
          </>
        )}
      </Button>
    </form>
  );
}
