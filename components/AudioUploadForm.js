import { useState, useRef, useEffect } from 'react';
import { ACCEPTED_AUDIO_TYPES, MAX_FILE_SIZE } from '../lib/constants';
import { uploadAudio, getTemplates, getSettings } from '../lib/api';
import AudioRecorder from './AudioRecorder';

export default function AudioUploadForm({ onSuccess }) {
  const [file, setFile] = useState(null);
  const [template, setTemplate] = useState('meeting');
  const [model, setModel] = useState('mistral-large-latest');
  const [templates, setTemplates] = useState([]);
  const [diarize, setDiarize] = useState(false);
  const [autoAnalyze, setAutoAnalyze] = useState(true);
  const [customPrompt, setCustomPrompt] = useState('');
  const [uploadMode, setUploadMode] = useState('file');
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    // Load custom templates and default settings
    Promise.all([getTemplates(), getSettings()])
      .then(([templatesData, settingsData]) => {
        setTemplates(templatesData);
        if (settingsData.defaultTemplate) {
          setTemplate(settingsData.defaultTemplate);
        }
      })
      .catch(err => console.error('Error loading upload options:', err));
  }, []);

  function validateFile(f) {
    const type = f.type.split(';')[0];
    if (!ACCEPTED_AUDIO_TYPES.includes(type) && !type.startsWith('audio/')) {
      return 'Ungültiger Dateityp. Bitte laden Sie eine Audio-Datei hoch.';
    }
    if (f.size > MAX_FILE_SIZE) {
      return 'Die Datei ist zu groß. Maximale Größe: 50 MB.';
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

      const result = await uploadAudio(file, { template, model, diarize, customPrompt, autoAnalyze });

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
      <div className="border-b border-white/[0.1] -mx-6 px-6 mb-1">
        <div className="flex gap-6">
          <button
            type="button"
            onClick={() => setUploadMode('file')}
            className={`pb-3 text-sm font-medium transition-colors relative ${
              uploadMode === 'file'
                ? 'text-accent-orange'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            Datei hochladen
            {uploadMode === 'file' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-accent-orange to-accent-cyan" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setUploadMode('record')}
            className={`pb-3 text-sm font-medium transition-colors relative ${
              uploadMode === 'record'
                ? 'text-accent-orange'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            Aufnehmen
            {uploadMode === 'record' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-accent-orange to-accent-cyan" />
            )}
          </button>
        </div>
      </div>

      {uploadMode === 'file' ? (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
            dragActive
              ? 'border-accent-orange bg-accent-orange/10'
              : 'border-white/[0.12] hover:border-white/[0.2]'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept="audio/*"
            capture="environment"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            className="hidden"
          />
          {file ? (
            <p className="text-sm text-text-primary">
              <span className="font-medium">{file.name}</span>{' '}
              <span className="text-text-secondary">
                ({(file.size / 1024 / 1024).toFixed(1)} MB)
              </span>
            </p>
          ) : (
            <div>
              <svg className="mx-auto w-10 h-10 text-text-secondary mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-sm text-text-secondary">
                Audio-Datei hierher ziehen oder <span className="text-accent-orange font-medium">durchsuchen</span>
              </p>
              <p className="text-xs text-text-secondary/60 mt-1">MP3, WAV, OGG, FLAC, M4A, WebM (max. 50 MB)</p>
            </div>
          )}
        </div>
      ) : (
        <AudioRecorder onRecordingComplete={handleRecordingComplete} />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label htmlFor="upload-template" className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-widest">Analyse-Modus</label>
          <select id="upload-template" value={template} onChange={(e) => setTemplate(e.target.value)} className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-text-primary focus:ring-1 focus:ring-accent-orange outline-none">
            <optgroup label="Standard"><option value="meeting">Meeting-Protokoll</option><option value="aufmass">Aufmaß</option><option value="generic">Zusammenfassung</option></optgroup>
            {templates.length > 0 && <optgroup label="Eigene Vorlagen">{templates.map(t => <option key={t.id} value={`custom-${t.id}`}>{t.name}</option>)}</optgroup>}
          </select>
        </div>
        <div>
          <label htmlFor="upload-model" className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-widest">KI-Modell</label>
          <select id="upload-model" value={model} onChange={(e) => setModel(e.target.value)} className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-text-primary focus:ring-1 focus:ring-accent-orange outline-none">
            <option value="mistral-large-latest">Mistral Large</option>
            <option value="mistral-medium-latest">Mistral Medium</option>
            <option value="mistral-small-latest">Mistral Small</option>
          </select>
        </div>
      </div>

      <div className="space-y-3 pt-2">
        <label className="flex items-center gap-3 cursor-pointer group">
          <input type="checkbox" checked={diarize} onChange={(e) => setDiarize(e.target.checked)} className="w-4 h-4 text-accent-orange bg-dark-input border-white/[0.2] rounded focus:ring-accent-orange" />
          <span className="text-sm text-text-secondary group-hover:text-text-primary transition-colors">Sprechererkennung aktivieren</span>
        </label>
        <label className="flex items-center gap-3 cursor-pointer group">
          <input type="checkbox" checked={autoAnalyze} onChange={(e) => setAutoAnalyze(e.target.checked)} className="w-4 h-4 text-accent-orange bg-dark-input border-white/[0.2] rounded focus:ring-accent-orange" />
          <span className="text-sm text-text-secondary group-hover:text-text-primary transition-colors">Direkt analysieren</span>
        </label>
      </div>

      <div>
        <label htmlFor="upload-prompt" className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-widest">Zusätzlicher Kontext</label>
        <textarea id="upload-prompt" value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)} placeholder="Teilnehmer, Projekte, Hinweise..." rows={2} className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-text-primary focus:ring-1 focus:ring-accent-orange outline-none resize-none" />
      </div>

      {error && <div className="bg-accent-red/10 border border-accent-red/20 text-accent-red px-4 py-3 rounded-lg text-sm">{error}</div>}

      {uploading && <div className="w-full bg-white/[0.06] rounded-full h-1.5"><div className="gradient-accent h-1.5 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} /></div>}

      <button type="submit" disabled={!file || uploading} className="w-full gradient-accent text-white py-3 rounded-xl text-sm font-bold shadow-lg shadow-accent-orange/20 disabled:opacity-30 transition-all hover:scale-[1.01]">
        {uploading ? 'Wird hochgeladen...' : 'Vorgang starten'}
      </button>
    </form>
  );
}