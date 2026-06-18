import { useState, useRef, useEffect } from 'react';
import { Mic, MonitorSpeaker, Upload } from 'lucide-react';
import { ACCEPTED_AUDIO_TYPES, MAX_FILE_SIZE, normalizeDefaultTemplate } from '../lib/constants';
import { uploadAudio, getTemplates, getSettings } from '../lib/api';
import AudioRecorder from './AudioRecorder';
import SystemAudioRecorder from './SystemAudioRecorder';
import { getSystemAudioCapabilities } from '../lib/audio-utils';
import { useTranslations } from '../lib/i18n';

// `aufmass` is intentionally absent from the user-facing offering but
// remains accepted by the backend (see lib/template-service.js) so legacy
// DB rows still resolve.
const BUILTIN_TEMPLATE_VALUES = new Set(['generic', 'meeting', 'action_items', 'data_table', 'aufmass']);
const ALLOWED_CHAT_MODELS = new Set(['deepseek-v4-pro', 'deepseek-v4-flash', 'kimi-2.6']);
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
      <div className="mb-2">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 p-1.5 rounded-2xl bg-hover-subtle border border-subtle">
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
                className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  active
                    ? 'gradient-accent text-white shadow-lg shadow-accent/25'
                    : 'text-secondary hover:text-primary hover:bg-hover'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {uploadMode === 'file' ? (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onClick={() => inputRef.current?.click()}
          onKeyDown={handleFileZoneKeyDown}
          role="button"
          tabIndex={0}
          aria-label={tForm('dragOrClick')}
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
            dragActive
              ? 'border-accent bg-accent/10'
              : 'border-emphasis hover:border-emphasis'
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
            <p className="text-sm text-primary">
              <span className="font-medium">{file.name}</span>{' '}
              <span className="text-secondary">
                ({(file.size / 1024 / 1024).toFixed(1)} MB)
              </span>
            </p>
          ) : (
            <div>
              <svg className="mx-auto w-10 h-10 text-secondary mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-sm text-secondary">{tForm('dragOrClick')}</p>
              <p className="text-xs text-secondary/60 mt-1">{t('fileFormats')}</p>
            </div>
          )}
        </div>
      ) : uploadMode === 'system-audio' && showSystemAudioTab ? (
        <SystemAudioRecorder onRecordingComplete={handleRecordingComplete} />
      ) : (
        <AudioRecorder onRecordingComplete={handleRecordingComplete} />
      )}

      <div className="space-y-3 pt-2">
        <label className="flex items-center gap-3 cursor-pointer group">
          <input type="checkbox" checked={diarize} onChange={(e) => setDiarize(e.target.checked)} className="w-4 h-4 accent-accent bg-surface-elevated border-emphasis rounded focus:ring-accent" />
          <span className="text-sm text-secondary group-hover:text-primary transition-colors">{t('diarize')}</span>
        </label>
        <label className="flex items-center gap-3 cursor-pointer group">
          <input type="checkbox" checked={autoAnalyze} onChange={(e) => setAutoAnalyze(e.target.checked)} className="w-4 h-4 accent-accent bg-surface-elevated border-emphasis rounded focus:ring-accent" />
          <span className="text-sm text-secondary group-hover:text-primary transition-colors">{t('autoAnalyze')}</span>
        </label>
      </div>

      <div className="pt-1">
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
      </div>

      {showAdvancedOptions && (
        <div className="space-y-4 bg-hover-subtle border border-subtle rounded-xl p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {!lockTemplate ? (
              <div>
                <label htmlFor="upload-template" className="block text-xs font-medium text-secondary mb-1.5 uppercase tracking-widest">Analyse-Modus</label>
                <select id="upload-template" value={template} onChange={(e) => setTemplate(e.target.value)} className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-sm text-primary focus:ring-1 focus:ring-accent outline-none">
                  <optgroup label="Standard"><option value="generic">Zusammenfassung</option><option value="meeting">Meeting-Protokoll</option><option value="action_items">To-Dos extrahieren</option></optgroup>
                  {textTemplates.length > 0 && <optgroup label="Eigene Text-Vorlagen">{textTemplates.map(t => <option key={t.id} value={`custom-${t.id}`}>{t.name}</option>)}</optgroup>}
                </select>
              </div>
            ) : (
              <div className="md:col-span-1">
                <label className="block text-xs font-medium text-secondary mb-1.5 uppercase tracking-widest">Analyse-Modus</label>
                <div className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-sm text-primary">
                  {templateLabel || template}
                </div>
              </div>
            )}
            <div>
              <label htmlFor="upload-model" className="block text-xs font-medium text-secondary mb-1.5 uppercase tracking-widest">KI-Modell</label>
              <select id="upload-model" value={model} onChange={(e) => setModel(e.target.value)} className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-sm text-primary focus:ring-1 focus:ring-accent outline-none">
                <option value="deepseek-v4-pro">DeepSeek V4 Pro</option>
                <option value="deepseek-v4-flash">DeepSeek V4 Flash</option>
                <option value="kimi-2.6">Kimi 2.6</option>
              </select>
              <p className="mt-1 text-[11px] text-secondary">DeepSeek V4 Pro ist der Standard; Flash ist für schnellere Antworten gedacht.</p>
            </div>
          </div>
          <div>
            <label htmlFor="upload-prompt" className="block text-xs font-medium text-secondary mb-1.5 uppercase tracking-widest">{t('additionalContext')}</label>
            <textarea id="upload-prompt" value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)} placeholder={t('additionalContextHint')} rows={2} className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-sm text-primary focus:ring-1 focus:ring-accent outline-none resize-none" />
          </div>
          <div>
            <label htmlFor="upload-analysis-focus" className="block text-xs font-medium text-secondary mb-1.5 uppercase tracking-widest">{t('analysisFocus')}</label>
            <textarea
              id="upload-analysis-focus"
              value={analysisFocus}
              onChange={(e) => setAnalysisFocus(e.target.value)}
              placeholder={t('analysisFocus')}
              rows={2}
              className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-sm text-primary focus:ring-1 focus:ring-accent outline-none resize-none"
            />
          </div>
        </div>
      )}

      {error && <div className="bg-danger/10 border border-danger/20 text-danger px-4 py-3 rounded-lg text-sm">{error}</div>}

      {uploading && (
        <progress
          className="upload-progress w-full"
          value={Math.max(0, Math.min(progress, 100))}
          max={100}
        />
      )}

      <button type="submit" disabled={!file || uploading} className="w-full gradient-accent text-white py-3 rounded-xl text-sm font-bold shadow-lg shadow-accent/20 disabled:opacity-30 transition-all hover:scale-[1.01]">
        {uploading ? t('submitting') : t('submit')}
      </button>
    </form>
  );
}
