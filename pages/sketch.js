import Head from 'next/head';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useRef, useState } from 'react';
import AudioUploadForm from '../components/AudioUploadForm';
import LoadingSpinner from '../components/LoadingSpinner';
import Toast from '../components/Toast';
import { generateSketchSummary as generateSketchSummaryApi } from '../lib/api';

const SOURCE_OPTIONS = [
  { value: 'text', label: 'Text' },
  { value: 'audio', label: 'Audio' },
  { value: 'document', label: 'PDF / Bild' },
];

const LAYOUT_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'timeline', label: 'Zeitleiste' },
  { value: 'process_flow', label: 'Prozessfluss' },
  { value: 'comparison', label: 'Vergleich' },
  { value: 'mindmap', label: 'Mindmap' },
  { value: 'topic_tree', label: 'Themenbaum' },
];

const DETAIL_OPTIONS = [
  { value: 'compact', label: 'Kompakt' },
  { value: 'standard', label: 'Standard' },
  { value: 'detailed', label: 'Detailliert' },
];

const ILLUSTRATION_STYLE_OPTIONS = [
  { value: 'editorial', label: 'Editorial' },
  { value: 'technical', label: 'Technisch' },
  { value: 'minimal', label: 'Minimal' },
];

const MIN_PREVIEW_ZOOM = 0.5;
const MAX_PREVIEW_ZOOM = 3;
const PREVIEW_ZOOM_STEP = 0.1;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampPreviewZoom(value) {
  return Math.min(MAX_PREVIEW_ZOOM, Math.max(MIN_PREVIEW_ZOOM, value));
}

function decodeBase64Utf8(base64Value) {
  if (!base64Value || typeof window === 'undefined') return '';
  try {
    const binary = window.atob(String(base64Value));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return '';
  }
}

export default function SketchPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const documentInputRef = useRef(null);

  const [source, setSource] = useState('text');
  const [inputText, setInputText] = useState('');
  const [documentFile, setDocumentFile] = useState(null);
  const [documentSubmitting, setDocumentSubmitting] = useState(false);
  const [audioImporting, setAudioImporting] = useState(false);
  const [audioStatus, setAudioStatus] = useState('');
  const [imageBase64, setImageBase64] = useState('');
  const [imageMimeType, setImageMimeType] = useState('image/png');
  const [isGenerating, setIsGenerating] = useState(false);
  const [toast, setToast] = useState(null);
  const [layoutMode, setLayoutMode] = useState('auto');
  const [detailLevel, setDetailLevel] = useState('standard');
  const [illustrationStyle, setIllustrationStyle] = useState('editorial');
  const [generationFocus, setGenerationFocus] = useState('');
  const [previewZoom, setPreviewZoom] = useState(1);
  const [decodedSvgMarkup, setDecodedSvgMarkup] = useState('');

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  const imageSrc = useMemo(() => {
    if (!imageBase64) return '';
    return `data:${imageMimeType || 'image/png'};base64,${imageBase64}`;
  }, [imageBase64, imageMimeType]);
  const isSvgPreview = useMemo(
    () => String(imageMimeType || '').toLowerCase().includes('svg'),
    [imageMimeType]
  );
  const downloadLabel = useMemo(
    () => (String(imageMimeType || '').toLowerCase().includes('svg') ? 'Als SVG herunterladen' : 'Als PNG herunterladen'),
    [imageMimeType]
  );
  const canGenerate = inputText.trim().length > 0 && !isGenerating && !documentSubmitting && !audioImporting;

  function appendImportedText(nextText, sourceLabel) {
    const cleaned = String(nextText || '').trim();
    if (!cleaned) {
      setToast({ type: 'error', message: `${sourceLabel}-Import lieferte keinen Text.` });
      return;
    }
    setInputText((previous) => {
      const base = String(previous || '').trim();
      return base ? `${base}\n\n${cleaned}` : cleaned;
    });
    setSource('text');
    setToast({ type: 'success', message: `${sourceLabel}-Text wurde übernommen.` });
  }

  async function startTranscription(transcriptionId) {
    const response = await fetch(`/api/transcriptions/${transcriptionId}/process`, {
      method: 'POST',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.message || 'Audio-Verarbeitung konnte nicht gestartet werden.');
    }
  }

  async function waitForTranscriptionText(transcriptionId) {
    const maxAttempts = 50;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const response = await fetch(`/api/transcriptions/${transcriptionId}`);
      if (response.ok) {
        const payload = await response.json().catch(() => ({}));
        const currentStatus = String(payload?.status || '');

        if (currentStatus === 'error') {
          throw new Error(payload?.error || 'Audio-Verarbeitung fehlgeschlagen.');
        }

        const extractedText = String(payload?.text || '').trim();
        if (extractedText && (currentStatus === 'transcribed' || currentStatus === 'completed')) {
          return extractedText;
        }

        if (currentStatus === 'analyzing') {
          setAudioStatus('Audio ist transkribiert, Analyse läuft noch …');
        } else if (currentStatus === 'processing' || currentStatus === 'queued' || currentStatus === 'pending') {
          setAudioStatus('Audio wird transkribiert …');
        }
      }

      await wait(2500);
    }

    throw new Error('Transkription dauert zu lange. Bitte später erneut versuchen.');
  }

  async function handleAudioSuccess(uploadResult) {
    if (!uploadResult?.id) return;

    setToast(null);
    setAudioImporting(true);
    setAudioStatus('Upload abgeschlossen. Starte Verarbeitung …');

    try {
      await startTranscription(uploadResult.id);
      const extractedText = await waitForTranscriptionText(uploadResult.id);
      appendImportedText(extractedText, 'Audio');
    } catch (error) {
      setToast({ type: 'error', message: error.message || 'Audio konnte nicht importiert werden.' });
    } finally {
      setAudioImporting(false);
      setAudioStatus('');
    }
  }

  async function handleDocumentSubmit(event) {
    event.preventDefault();
    if (!documentFile) {
      setToast({ type: 'error', message: 'Bitte zuerst eine PDF- oder Bilddatei auswählen.' });
      return;
    }

    setToast(null);
    setDocumentSubmitting(true);

    try {
      const formData = new FormData();
      formData.append('file', documentFile);
      formData.append('analyze', 'false');

      const response = await fetch('/api/ocr', {
        method: 'POST',
        body: formData,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message || 'OCR konnte nicht ausgeführt werden.');
      }

      appendImportedText(payload?.markdown || '', 'OCR');
      setDocumentFile(null);
    } catch (error) {
      setToast({ type: 'error', message: error.message || 'OCR konnte nicht importiert werden.' });
    } finally {
      setDocumentSubmitting(false);
    }
  }

  async function handleGenerate() {
    if (!inputText.trim()) {
      setToast({ type: 'error', message: 'Bitte zuerst einen Text eingeben.' });
      return;
    }

    setIsGenerating(true);
    setToast(null);
    try {
      const payload = await generateSketchSummaryApi({
        text: inputText.trim(),
        layoutMode,
        detailLevel,
        illustrationStyle,
        focus: generationFocus.trim(),
      });
      if (!payload?.imageBase64) {
        throw new Error('Kein Bild im API-Response erhalten.');
      }

      setImageBase64(String(payload.imageBase64));
      const nextMimeType = String(payload.mimeType || 'image/png');
      setImageMimeType(nextMimeType);
      setPreviewZoom(1);
      if (nextMimeType.toLowerCase().includes('svg')) {
        setDecodedSvgMarkup(decodeBase64Utf8(payload.imageBase64));
      } else {
        setDecodedSvgMarkup('');
      }
      if (payload?.notice) {
        setToast({ type: 'info', message: String(payload.notice) });
      }
    } catch (error) {
      setToast({ type: 'error', message: error.message || 'Infografik konnte nicht erstellt werden.' });
    } finally {
      setIsGenerating(false);
    }
  }

  function handleDownloadPng() {
    if (!imageSrc || isGenerating) return;

    const lowerMime = String(imageMimeType || '').toLowerCase();
    const extension = lowerMime.includes('svg') ? 'svg' : 'png';
    const anchor = document.createElement('a');
    anchor.href = imageSrc;
    anchor.download = `infografik.${extension}`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  }

  function handleZoomIn() {
    setPreviewZoom((current) => clampPreviewZoom(current + PREVIEW_ZOOM_STEP));
  }

  function handleZoomOut() {
    setPreviewZoom((current) => clampPreviewZoom(current - PREVIEW_ZOOM_STEP));
  }

  function handleZoomReset() {
    setPreviewZoom(1);
  }

  function handlePreviewWheel(event) {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const direction = event.deltaY < 0 ? 1 : -1;
    setPreviewZoom((current) => clampPreviewZoom(current + (direction * PREVIEW_ZOOM_STEP)));
  }

  if (status === 'loading' || !session) return <LoadingSpinner />;

  return (
    <>
      <Head>
        <title>Infografik - GhostTyper</title>
      </Head>

      <div className="max-w-6xl mx-auto pb-20 animate-fade-in space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Infografik</h1>
          <p className="text-sm text-text-secondary mt-1">
            Lerntext per Texteingabe, Audio oder OCR erfassen und als visuelle Lernübersicht generieren.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 bg-dark-card border border-white/[0.06] rounded-2xl p-5 space-y-4">
            <div className="bg-dark-card border border-white/[0.06] rounded-2xl p-2 inline-flex gap-2 w-full justify-center">
              {SOURCE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setSource(option.value)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                    source === option.value
                      ? 'bg-accent-orange/20 text-accent-orange border border-accent-orange/30'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {source === 'audio' && (
              <div className="space-y-3">
                <p className="text-xs text-text-secondary">
                  Datei hochladen oder direkt aufnehmen. Der transkribierte Text wird anschließend in das Eingabefeld übernommen.
                </p>
                <AudioUploadForm
                  onSuccess={handleAudioSuccess}
                  presetConfig={{
                    template: 'generic',
                    model: 'mistral-small-latest',
                    diarize: false,
                    autoAnalyze: false,
                  }}
                />
                {audioImporting && (
                  <p className="text-xs text-accent-cyan">{audioStatus || 'Audio wird importiert …'}</p>
                )}
              </div>
            )}

            {source === 'document' && (
              <form onSubmit={handleDocumentSubmit} className="space-y-3">
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
                  className="border-2 border-dashed border-white/[0.12] hover:border-white/[0.2] rounded-2xl p-5 text-center cursor-pointer transition-colors"
                >
                  <input
                    ref={documentInputRef}
                    type="file"
                    accept=".pdf,image/*"
                    onChange={(event) => setDocumentFile(event.target.files?.[0] || null)}
                    className="hidden"
                  />
                  {documentFile ? (
                    <p className="text-sm text-text-primary">
                      {documentFile.name}{' '}
                      <span className="text-text-secondary">({(documentFile.size / 1024 / 1024).toFixed(1)} MB)</span>
                    </p>
                  ) : (
                    <p className="text-sm text-text-secondary">PDF oder Bild auswählen</p>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={!documentFile || documentSubmitting}
                  className="w-full gradient-accent text-white px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40"
                >
                  {documentSubmitting ? 'OCR läuft …' : 'OCR-Text übernehmen'}
                </button>
              </form>
            )}

            {source === 'text' && (
              <p className="text-xs text-text-secondary">
                Lernstoff direkt einfügen oder die Quellen oben nutzen, um Text automatisch zu übernehmen.
              </p>
            )}

            <label className="block text-[10px] font-bold text-text-secondary uppercase tracking-widest">
              Eingabetext
            </label>
            <textarea
              value={inputText}
              onChange={(event) => setInputText(event.target.value)}
              placeholder="Lernstoff oder Notizen hier einfügen..."
              className="w-full h-56 sm:h-72 lg:h-[430px] bg-dark-input border border-white/[0.1] rounded-xl p-4 text-sm text-text-primary outline-none resize-none"
            />
            <p className="text-[11px] text-text-secondary">
              Tipp: Nutze klare Stichpunkte oder Absätze für bessere Ergebnisse.
            </p>

            <div className="space-y-3 border border-white/[0.08] rounded-xl p-3 bg-white/[0.01]">
              <p className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">
                Studio-Einstellungen
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] text-text-secondary mb-1">Layout</label>
                  <select
                    value={layoutMode}
                    onChange={(event) => setLayoutMode(event.target.value)}
                    className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-text-primary outline-none"
                  >
                    {LAYOUT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-text-secondary mb-1">Detailgrad</label>
                  <select
                    value={detailLevel}
                    onChange={(event) => setDetailLevel(event.target.value)}
                    className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-text-primary outline-none"
                  >
                    {DETAIL_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-text-secondary mb-1">Stil</label>
                  <select
                    value={illustrationStyle}
                    onChange={(event) => setIllustrationStyle(event.target.value)}
                    className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-text-primary outline-none"
                  >
                    {ILLUSTRATION_STYLE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[11px] text-text-secondary mb-1">Fokus</label>
                <input
                  value={generationFocus}
                  onChange={(event) => setGenerationFocus(event.target.value)}
                  placeholder="z. B. Ursachen und Wirkungen priorisieren"
                  className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-text-primary outline-none"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={!canGenerate}
                className="flex-1 gradient-accent text-white px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40"
              >
                {isGenerating ? 'Generiere...' : 'Zusammenfassung generieren'}
              </button>
              <button
                type="button"
                onClick={() => setInputText('')}
                disabled={isGenerating}
                className="px-4 py-2.5 rounded-xl text-sm border border-white/[0.1] text-text-secondary hover:text-text-primary hover:bg-white/[0.04] disabled:opacity-40"
              >
                Leeren
              </button>
            </div>
          </div>

          <div className="lg:col-span-8 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-text-primary">Vorschau</h2>
              <div className="flex items-center gap-2">
                <div className="inline-flex items-center rounded-xl border border-white/[0.12] bg-white/[0.03] overflow-hidden">
                  <button
                    type="button"
                    onClick={handleZoomOut}
                    disabled={!imageSrc}
                    className="px-2.5 py-1.5 text-sm text-text-secondary hover:text-text-primary hover:bg-white/[0.06] disabled:opacity-35"
                    aria-label="Herauszoomen"
                  >
                    -
                  </button>
                  <button
                    type="button"
                    onClick={handleZoomReset}
                    disabled={!imageSrc}
                    className="px-2.5 py-1.5 text-[11px] font-semibold text-text-secondary hover:text-text-primary hover:bg-white/[0.06] disabled:opacity-35 min-w-[56px]"
                    aria-label="Zoom zurücksetzen"
                  >
                    {Math.round(previewZoom * 100)}%
                  </button>
                  <button
                    type="button"
                    onClick={handleZoomIn}
                    disabled={!imageSrc}
                    className="px-2.5 py-1.5 text-sm text-text-secondary hover:text-text-primary hover:bg-white/[0.06] disabled:opacity-35"
                    aria-label="Hereinzoomen"
                  >
                    +
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleDownloadPng}
                  disabled={!imageSrc || isGenerating}
                  className="px-4 py-2 rounded-xl text-sm border border-cyan-400/40 text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 disabled:opacity-35"
                >
                  {downloadLabel}
                </button>
              </div>
            </div>

            <div
              onWheel={handlePreviewWheel}
              className="relative bg-dark-card border border-white/[0.06] rounded-2xl p-4 min-h-[280px] sm:min-h-[420px] lg:min-h-[640px] flex items-center justify-center overflow-auto"
            >
              {imageSrc ? (
                <div
                  className="mx-auto transition-transform duration-150 ease-out"
                  style={{ transform: `scale(${previewZoom})`, transformOrigin: 'top center' }}
                >
                  {isSvgPreview && decodedSvgMarkup ? (
                    <div
                      className="rounded-xl border border-white/10 shadow-lg bg-white overflow-hidden [&>svg]:w-full [&>svg]:h-auto"
                      style={{ width: 'min(100%, 1200px)' }}
                      // eslint-disable-next-line react/no-danger
                      dangerouslySetInnerHTML={{ __html: decodedSvgMarkup }}
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={imageSrc}
                      alt="Generierte Infografik"
                      className="max-h-[74vh] lg:max-h-[820px] w-auto max-w-full rounded-xl border border-white/10 shadow-lg"
                    />
                  )}
                </div>
              ) : (
                <p className="text-sm text-text-secondary">
                  {isGenerating ? 'Infografik wird vorbereitet...' : 'Noch keine Grafik erzeugt.'}
                </p>
              )}

              {isGenerating && (
                <div className="absolute inset-0 bg-dark-bg/70 backdrop-blur-[1px] flex flex-col items-center justify-center gap-3">
                  <div className="w-8 h-8 border-2 border-white/30 border-t-accent-orange rounded-full animate-spin" aria-hidden="true" />
                  <p className="text-sm text-text-primary">Neue Infografik wird generiert...</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </>
  );
}
