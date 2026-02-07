import { useState, useRef } from 'react';
import { ACCEPTED_AUDIO_TYPES, MAX_FILE_SIZE } from '../lib/constants';
import { uploadAudio } from '../lib/api';

export default function AudioUploadForm({ onSuccess }) {
  const [file, setFile] = useState(null);
  const [template, setTemplate] = useState('meeting');
  const [diarize, setDiarize] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  function validateFile(f) {
    if (!ACCEPTED_AUDIO_TYPES.includes(f.type)) {
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

      const result = await uploadAudio(file, { template, diarize, customPrompt });

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
      <div
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
          dragActive
            ? 'border-google-blue bg-blue-50'
            : 'border-google-gray-300 hover:border-google-gray-400'
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
          <p className="text-sm text-google-gray-700">
            <span className="font-medium">{file.name}</span>{' '}
            <span className="text-google-gray-500">
              ({(file.size / 1024 / 1024).toFixed(1)} MB)
            </span>
          </p>
        ) : (
          <div>
            <svg className="mx-auto w-10 h-10 text-google-gray-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-sm text-google-gray-600">
              Audio-Datei hierher ziehen oder <span className="text-google-blue font-medium">durchsuchen</span>
            </p>
            <p className="text-xs text-google-gray-400 mt-1">MP3, WAV, OGG, FLAC, M4A (max. 50 MB)</p>
          </div>
        )}
      </div>

      <div>
        <label htmlFor="upload-template" className="block text-sm font-medium text-google-gray-700 mb-1.5">
          Analyse-Template
        </label>
        <select
          id="upload-template"
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          className="w-full border border-google-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-google-blue focus:border-google-blue outline-none bg-white"
        >
          <option value="meeting">Meeting-Protokoll</option>
          <option value="aufmass">Aufmaß</option>
          <option value="generic">Allgemein</option>
        </select>
      </div>

      <div className="flex items-center gap-3">
        <input
          id="upload-diarize"
          type="checkbox"
          checked={diarize}
          onChange={(e) => setDiarize(e.target.checked)}
          className="w-4 h-4 text-google-blue border-google-gray-300 rounded focus:ring-google-blue"
        />
        <label htmlFor="upload-diarize" className="text-sm text-google-gray-700">
          Sprechererkennung aktivieren
          <span className="block text-xs text-google-gray-500">
            Erkennt verschiedene Sprecher und ermöglicht Namenszuweisung vor der Analyse
          </span>
        </label>
      </div>

      <div>
        <label htmlFor="upload-prompt" className="block text-sm font-medium text-google-gray-700 mb-1.5">
          Zusätzlicher Kontext <span className="font-normal text-google-gray-400">(optional)</span>
        </label>
        <textarea
          id="upload-prompt"
          value={customPrompt}
          onChange={(e) => setCustomPrompt(e.target.value)}
          placeholder="z.B. Teilnehmer, Projektname, besondere Hinweise für die Analyse..."
          rows={3}
          className="w-full border border-google-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-google-blue focus:border-google-blue outline-none resize-none"
        />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-google-red px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {uploading && (
        <div className="w-full bg-google-gray-200 rounded-full h-1.5">
          <div
            className="bg-google-blue h-1.5 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      <button
        type="submit"
        disabled={!file || uploading}
        className="w-full bg-google-blue text-white py-2.5 rounded-full text-sm font-medium hover:bg-google-blue-hover disabled:bg-google-gray-300 disabled:cursor-not-allowed transition-colors"
      >
        {uploading ? 'Wird hochgeladen...' : 'Hochladen und transkribieren'}
      </button>
    </form>
  );
}
