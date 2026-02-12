import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { exportToDoc } from '../lib/export-utils';
import DOMPurify from 'dompurify';
import { buildPdfPrintStyles } from '../lib/pdf-print-style';

const LANGUAGES = [
  { code: 'German', label: 'Deutsch' },
  { code: 'English', label: 'Englisch' },
  { code: 'French', label: 'Französisch' },
  { code: 'Spanish', label: 'Spanisch' },
  { code: 'Chinese', label: 'Chinesisch' },
];

const FIXED_PDF_THEME = 'atelier';
const FIXED_PDF_FONT = 'google-sans';

export default function DocumentEditor({
  initialHtml,
  onSave,
  onCancel,
  filename,
  sidebarContent,
  sourceLabel = 'Transkript',
}) {
  const [html, setHtml] = useState(initialHtml);
  const [isTranslating, setIsTranslating] = useState(false);
  const [targetLang, setTargetLang] = useState('German');
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [pdfPremiumEnabled, setPdfPremiumEnabled] = useState(false);
  const [pdfSettingsLoading, setPdfSettingsLoading] = useState(true);
  const [focusMode, setFocusMode] = useState(false);
  const [focusPreset, setFocusPreset] = useState('paper');
  const [showSourceContent, setShowSourceContent] = useState(false);
  const editorRef = useRef(null);

  const sanitizeEditorHtml = useCallback((value) => {
    if (typeof window === 'undefined') return String(value || '');
    return DOMPurify.sanitize(String(value || ''), { USE_PROFILES: { html: true } });
  }, []);

  const sanitizedHtml = useMemo(() => {
    return sanitizeEditorHtml(html);
  }, [html, sanitizeEditorHtml]);

  useEffect(() => {
    setHtml(initialHtml);
  }, [initialHtml]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        if (focusMode) setFocusMode(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusMode]);

  useEffect(() => {
    let active = true;

    const loadPdfSettings = async () => {
      try {
        const res = await fetch('/api/settings');
        if (!res.ok) return;
        const data = await res.json();
        if (!active) return;
        setPdfPremiumEnabled(Boolean(data?.pdfPremiumEnabledDefault));
      } catch (_) {
        // Keep default off if settings are temporarily unavailable.
      } finally {
        if (active) {
          setPdfSettingsLoading(false);
        }
      }
    };

    loadPdfSettings();
    return () => {
      active = false;
    };
  }, []);

  const execCommand = (command, value = null) => {
    if (editorRef.current) editorRef.current.focus();
    document.execCommand(command, false, value);
  };

  const handleCopy = async () => {
    const currentText = editorRef.current?.innerText || "";
    try {
      await navigator.clipboard.writeText(currentText);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    } catch (err) {
      console.error('Failed to copy!', err);
    }
  };

  const handleSave = useCallback(async () => {
    const currentHtml = sanitizeEditorHtml(editorRef.current?.innerHTML || html);
    try {
      await onSave(currentHtml);
      setSaveFeedback(true);
      setTimeout(() => setSaveFeedback(false), 2000);
    } catch (err) {
      console.error('Failed to save!', err);
    }
  }, [html, onSave, sanitizeEditorHtml]);

  useEffect(() => {
    const handleShortcut = (event) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key?.toLowerCase() !== 's') return;
      event.preventDefault();
      handleSave();
    };

    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [handleSave]);

  const handleExportDoc = () => {
    const currentHtml = sanitizeEditorHtml(editorRef.current?.innerHTML || html);
    exportToDoc(currentHtml, filename);
  };

  const openPdfBlob = (blob, targetWindow = null) => {
    const url = window.URL.createObjectURL(blob);
    const canUseTarget = targetWindow && !targetWindow.closed;

    if (canUseTarget) {
      targetWindow.location.href = url;
    } else {
      const opened = window.open(url, '_blank', 'noopener,noreferrer');
      if (!opened) {
        // Last fallback when popups are blocked: open in the current tab.
        window.location.href = url;
      }
    }

    // Give the target enough time to load the blob before revoking.
    window.setTimeout(() => {
      window.URL.revokeObjectURL(url);
    }, 60_000);
  };

  const handleExportPdfLegacy = (existingWindow = null) => {
    const currentHtml = editorRef.current?.innerHTML || html;
    const printableHtml = DOMPurify.sanitize(currentHtml || '', { USE_PROFILES: { html: true } });
    const printStyles = buildPdfPrintStyles({ theme: FIXED_PDF_THEME, fontPreset: FIXED_PDF_FONT });
    const printWindow = existingWindow && !existingWindow.closed
      ? existingWindow
      : window.open('', '_blank', 'noopener,noreferrer,width=1024,height=900');

    if (!printWindow) {
      window.print();
      return;
    }

    printWindow.document.open();
    printWindow.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title></title>
    <style>${printStyles}</style>
  </head>
  <body>
    <main id="print-root">${printableHtml}</main>
  </body>
</html>`);
    printWindow.document.close();

    const triggerPrint = () => {
      printWindow.focus();
      printWindow.print();
      setTimeout(() => {
        printWindow.close();
      }, 300);
    };

    if (printWindow.document.readyState === 'complete') {
      setTimeout(triggerPrint, 120);
    } else {
      printWindow.onload = () => setTimeout(triggerPrint, 120);
    }
  };

  const handleExportPdf = async () => {
    if (isExportingPdf) return;
    const previewWindow = window.open('', '_blank', 'noopener,noreferrer,width=1024,height=900');

    if (previewWindow) {
      previewWindow.document.open();
      previewWindow.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>PDF Export</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; padding: 2rem; background: #0b0b10; color: #e8e8ed; }
      .muted { color: #9aa0b2; font-size: 0.9rem; }
    </style>
  </head>
  <body>
    <h1>PDF wird erstellt…</h1>
    <p class="muted">Dieser Tab aktualisiert sich automatisch, sobald das PDF fertig ist.</p>
  </body>
</html>`);
      previewWindow.document.close();
    }

    setIsExportingPdf(true);

    try {
      const currentHtml = editorRef.current?.innerHTML || html;
      const payloadHtml = DOMPurify.sanitize(currentHtml || '', { USE_PROFILES: { html: true } });
      const response = await fetch('/api/export/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          html: payloadHtml,
          filename,
          theme: FIXED_PDF_THEME,
          fontPreset: FIXED_PDF_FONT,
          premiumLayout: pdfPremiumEnabled,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.message || 'PDF_EXPORT_API_FAILED');
      }

      const blob = await response.blob();
      openPdfBlob(blob, previewWindow);
    } catch (error) {
      const shouldUseBrowserFallback = window.confirm(
        'Der serverseitige PDF-Export ist gerade nicht verfügbar. Browser-Export als Fallback starten?'
      );
      if (shouldUseBrowserFallback) {
        handleExportPdfLegacy(previewWindow);
      } else if (previewWindow && !previewWindow.closed) {
        previewWindow.close();
      }
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleTranslateAction = async () => {
    const currentHtml = sanitizeEditorHtml(editorRef.current?.innerHTML || html);
    if (!currentHtml || isTranslating) return;
    
    setIsTranslating(true);
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: currentHtml, targetLanguage: targetLang }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setHtml(sanitizeEditorHtml(data.translatedText));
    } catch (err) {
      alert('Fehler bei der Übersetzung: ' + err.message);
    } finally {
      setIsTranslating(false);
    }
  };

  const handleEditorInput = useCallback((event) => {
    const rawHtml = event.currentTarget.innerHTML || '';
    const cleanHtml = sanitizeEditorHtml(rawHtml);

    if (cleanHtml !== rawHtml) {
      event.currentTarget.innerHTML = cleanHtml;
    }

    setHtml(cleanHtml);
  }, [sanitizeEditorHtml]);

  const handleEditorPaste = useCallback((event) => {
    event.preventDefault();
    const clipboard = event.clipboardData;
    if (!clipboard) return;

    const pastedHtml = clipboard.getData('text/html');
    if (pastedHtml) {
      const cleanHtml = sanitizeEditorHtml(pastedHtml);
      document.execCommand('insertHTML', false, cleanHtml);
      return;
    }

    const pastedText = clipboard.getData('text/plain');
    if (pastedText) {
      document.execCommand('insertText', false, pastedText);
    }
  }, [sanitizeEditorHtml]);

  return (
    <div className={`fixed inset-0 z-[100] bg-dark-bg flex flex-col animate-fade-in print-root ${focusMode ? `focus-mode focus-theme-${focusPreset}` : ''}`}>
      {/* Top Navbar */}
      <nav className={`min-h-16 border-b flex flex-wrap md:flex-nowrap items-center justify-between gap-2 px-3 md:px-6 py-2 md:py-0 shrink-0 no-print ${
        focusMode
          ? focusPreset === 'paper'
            ? 'bg-[#f3f2ee] border-black/10 backdrop-blur-md md:min-h-14 md:px-8'
            : 'bg-[#0b0b10] border-white/10 backdrop-blur-md md:min-h-14 md:px-8'
          : 'bg-dark-card border-white/[0.06]'
      }`}>
        {focusMode ? (
          <div className="w-full flex items-center justify-end gap-2 md:gap-3">
            <div className={`flex items-center rounded-lg p-0.5 border ${
              focusPreset === 'paper'
                ? 'bg-black/5 border-black/10'
                : 'bg-white/5 border-white/10'
            }`}>
              <button
                onClick={() => setFocusPreset('paper')}
                className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-colors ${
                  focusPreset === 'paper'
                    ? 'bg-white text-black'
                    : 'text-white/80 hover:text-white bg-white/5'
                }`}
              >
                Hell
              </button>
              <button
                onClick={() => setFocusPreset('ink')}
                className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-colors ${
                  focusPreset === 'ink'
                    ? 'bg-[#1a1b22] text-white'
                    : 'text-black bg-white/90 border border-black/20 hover:bg-white'
                }`}
              >
                Dunkel
              </button>
            </div>
            <button
              onClick={() => setFocusMode(false)}
              className={`px-4 py-2 text-xs font-bold rounded-xl transition-all ${
                focusPreset === 'paper'
                  ? 'bg-black/10 text-black border border-black/20'
                  : 'bg-accent-orange/20 text-accent-orange border border-accent-orange/30'
              }`}
            >
              Fokus aus
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 md:gap-4 min-w-0">
              <button onClick={onCancel} className="p-2 rounded-full transition-all text-text-secondary hover:text-accent-orange bg-white/5">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              </button>
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-accent-orange uppercase tracking-widest leading-none">Editor</span>
                <span className="text-sm font-medium text-text-primary truncate max-w-[200px]">{filename}</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 md:gap-3 w-full md:w-auto justify-end">
              <button onClick={handleSave} className={`px-4 py-2 text-xs font-bold rounded-xl transition-all ${
                saveFeedback
                  ? 'bg-accent-green/20 text-accent-green'
                  : 'text-text-primary hover:bg-white/5'
              }`}>
                {saveFeedback ? 'Gespeichert!' : 'Speichern ⌘S'}
              </button>

              <button
                onClick={handleExportPdf}
                disabled={isExportingPdf}
                className="gradient-accent text-white px-5 py-2 rounded-xl text-xs font-bold shadow-lg active:scale-95 disabled:opacity-50"
              >
                {isExportingPdf ? 'PDF wird erstellt…' : 'PDF exportieren'}
              </button>

              <button
                onClick={handleExportDoc}
                className="px-4 py-2 text-xs font-bold rounded-xl border transition-colors bg-white/5 hover:bg-white/10 border-white/10 text-text-primary"
              >
                DOCX exportieren
              </button>

              <div className="flex items-center gap-2 bg-white/5 rounded-xl px-2 py-1 border border-white/5">
                <select value={targetLang} onChange={e => setTargetLang(e.target.value)} className="bg-transparent text-[10px] text-text-primary outline-none cursor-pointer">
                  {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                </select>
                <button
                  onClick={handleTranslateAction}
                  disabled={isTranslating}
                  className="text-[10px] font-bold text-accent-orange hover:text-white transition-colors uppercase tracking-wider px-2"
                >
                  {isTranslating ? '...' : 'Übersetzen'}
                </button>
              </div>
              <button
                onClick={handleCopy}
                className={`px-3 py-2 text-xs font-bold rounded-xl transition-all ${
                  copyFeedback ? 'bg-accent-green/20 text-accent-green' : 'text-text-primary hover:bg-white/5 border border-transparent'
                }`}
              >
                {copyFeedback ? 'Kopiert!' : 'Text kopieren'}
              </button>

              <label className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-[10px] font-bold uppercase tracking-wide border-white/10 bg-white/5 text-text-secondary">
            <span>Kopfbereich</span>
            <input
              type="checkbox"
              checked={pdfPremiumEnabled}
              onChange={(e) => setPdfPremiumEnabled(e.target.checked)}
              disabled={pdfSettingsLoading}
              className="h-3.5 w-3.5 accent-accent-orange"
            />
          </label>

              <button
                onClick={() => setFocusMode(true)}
                className="inline-flex px-4 py-2 text-xs font-bold rounded-xl transition-all text-text-primary hover:bg-white/5"
              >
                Fokus
              </button>
            </div>
          </>
        )}
      </nav>

      <div className="flex-1 flex overflow-hidden relative">
        <main className={`flex-1 overflow-y-auto relative flex flex-col items-center custom-scrollbar print:bg-white print:overflow-visible ${
          focusMode
            ? focusPreset === 'paper'
              ? 'bg-[#efeee9]'
              : 'bg-[#09090d]'
            : 'bg-[#0a0a0f]'
        }`}>
          {/* Formatting Bar - Fixed bottom on mobile, sticky top on desktop */}
          <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 md:sticky md:top-6 md:bottom-auto md:translate-x-0 mb-4 no-print ${focusMode ? 'hidden' : ''}`}>
            <div className="bg-dark-card/90 backdrop-blur-2xl border border-white/[0.08] rounded-2xl p-1.5 shadow-2xl flex items-center gap-0.5 max-w-[95vw] overflow-x-auto no-scrollbar">
              <button onMouseDown={(e) => { e.preventDefault(); execCommand('bold'); }} className="p-2.5 text-text-secondary hover:text-accent-orange hover:bg-white/5 rounded-xl font-bold">B</button>
              <button onMouseDown={(e) => { e.preventDefault(); execCommand('italic'); }} className="p-2.5 text-text-secondary hover:text-accent-orange hover:bg-white/5 rounded-xl italic">I</button>
              <button onMouseDown={(e) => { e.preventDefault(); execCommand('underline'); }} className="p-2.5 text-text-secondary hover:text-accent-orange hover:bg-white/5 rounded-xl underline">U</button>
              <div className="w-px h-4 bg-white/10 mx-1.5" />
              <button onMouseDown={(e) => { e.preventDefault(); execCommand('formatBlock', 'h2'); }} className="p-2 text-text-secondary hover:text-accent-orange rounded-xl text-xs font-bold">H2</button>
              <button onMouseDown={(e) => { e.preventDefault(); execCommand('formatBlock', 'h3'); }} className="p-2 text-text-secondary hover:text-accent-orange rounded-xl text-[10px] font-bold">H3</button>
              <button onMouseDown={(e) => { e.preventDefault(); execCommand('formatBlock', 'p'); }} className="p-2 text-text-secondary hover:text-accent-orange rounded-xl text-[10px] font-bold">P</button>
              <div className="w-px h-4 bg-white/10 mx-1.5" />
              <button onMouseDown={(e) => { e.preventDefault(); execCommand('insertUnorderedList'); }} className="p-2.5 text-text-secondary hover:text-accent-orange hover:bg-white/5 rounded-xl">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
              </button>
              <button onMouseDown={(e) => { e.preventDefault(); execCommand('insertOrderedList'); }} className="p-2.5 text-text-secondary hover:text-accent-orange hover:bg-white/5 rounded-xl">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h10M7 16h10M4 8h.01M4 12h.01M4 16h.01" /></svg>
              </button>
            </div>
          </div>

          {/* Paper / Editor Surface */}
          <div className={`w-full ${focusMode ? 'max-w-[980px]' : 'max-w-[850px]'} px-4 md:px-8 ${focusMode ? 'pt-8 md:pt-12 pb-28' : 'pb-20'} print:p-0 print:w-full print:max-w-none`}>
            <div 
              id="editor-content-to-print"
              className={`text-[#e8e8ed] min-h-[300px] md:min-h-[500px] focus:outline-none prose prose-invert max-w-none print:bg-white print:text-black print:p-[25mm] print:shadow-none print:rounded-none print:border-none print:block ${
                focusMode
                  ? focusPreset === 'paper'
                    ? 'bg-[#f8f7f4] border border-black/[0.08] py-14 px-8 md:px-24 rounded-2xl shadow-none'
                    : 'bg-[#14141b] border border-white/[0.06] py-14 px-8 md:px-24 rounded-2xl shadow-none'
                  : 'bg-[#16161f] border border-white/[0.04] py-10 px-6 md:px-20 rounded-3xl shadow-2xl'
              } ${isTranslating ? 'opacity-50 pointer-events-none' : ''}`}
              contentEditable 
              ref={editorRef} 
              dangerouslySetInnerHTML={{ __html: sanitizedHtml }} 
              onInput={handleEditorInput}
              onPaste={handleEditorPaste}
              spellCheck="false"
            />

            {sidebarContent && !focusMode && (
              <section className="mt-4 no-print bg-dark-card border border-white/[0.06] rounded-2xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowSourceContent((prev) => !prev)}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm text-text-primary hover:bg-white/[0.03] transition-colors"
                  aria-expanded={showSourceContent}
                >
                  <span>{showSourceContent ? `${sourceLabel} ausblenden` : `${sourceLabel} anzeigen`}</span>
                  <svg
                    className={`w-4 h-4 text-text-secondary transition-transform ${showSourceContent ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showSourceContent && (
                  <div className="border-t border-white/[0.06] px-4 py-4 text-xs text-text-secondary whitespace-pre-wrap leading-relaxed max-h-[320px] overflow-y-auto custom-scrollbar font-mono">
                    {sidebarContent}
                  </div>
                )}
              </section>
            )}
          </div>
        </main>
      </div>

      <style jsx global>{`
        /* PRINT LOGIC - NO-PRINT APPROACH */
        @media print {
          @page {
            margin: 20mm 16mm 22mm 16mm;
            size: portrait;
          }

          body * {
            visibility: hidden !important;
          }

          .print-root, .print-root * {
            visibility: visible !important;
          }
          
          /* Hide non-essential UI elements */
          .no-print, nav, aside, .sticky, button, .fixed, [class*="no-print"] {
            display: none !important;
            height: 0 !important;
            overflow: hidden !important;
          }

          /* Reset containers for print */
          body, html {
            background: white !important;
            color: black !important;
            height: auto !important;
            overflow: visible !important;
            margin: 0 !important;
            padding: 0 !important;
          }

          .print-root {
            position: static !important;
            display: block !important;
            background: white !important;
            padding: 0 !important;
            margin: 0 !important;
            height: auto !important;
          }

          main {
            background: white !important;
            padding: 0 !important;
            margin: 0 !important;
            display: block !important;
            overflow: visible !important;
            height: auto !important;
          }

          /* Ensure the editor surface is full width and visible */
          #editor-content-to-print {
            background: white !important;
            color: black !important;
            padding: 0 !important;
            margin: 0 !important;
            width: 100% !important;
            max-width: none !important;
            box-shadow: none !important;
            min-height: auto !important;
            border: none !important;
            display: block !important;
            visibility: visible !important;
            position: static !important;
          }

          /* Keep headings with following content where possible */
          #editor-content-to-print h1,
          #editor-content-to-print h2,
          #editor-content-to-print h3 {
            break-after: avoid-page !important;
            page-break-after: avoid !important;
            break-inside: avoid-page !important;
            page-break-inside: avoid !important;
          }

          #editor-content-to-print h1 + *,
          #editor-content-to-print h2 + *,
          #editor-content-to-print h3 + * {
            break-before: avoid-page !important;
            page-break-before: avoid !important;
          }

          /* Reduce awkward splits for common content blocks */
          #editor-content-to-print p,
          #editor-content-to-print blockquote,
          #editor-content-to-print pre,
          #editor-content-to-print table,
          #editor-content-to-print tr {
            break-inside: avoid-page !important;
            page-break-inside: avoid !important;
          }

          #editor-content-to-print p,
          #editor-content-to-print li {
            orphans: 3;
            widows: 3;
            break-inside: auto !important;
            page-break-inside: auto !important;
          }

          /* Restore List Styles for Print */
          #editor-content-to-print ul {
            list-style-type: disc !important;
            padding-left: 2rem !important;
            display: block !important;
          }
          
          #editor-content-to-print ol {
            list-style-type: decimal !important;
            padding-left: 2rem !important;
            display: block !important;
          }

          #editor-content-to-print li {
            display: list-item !important;
          }
        }
        
        /* Prose Editor Styles */
        .prose h1.main-title { font-size: 2.25rem !important; color: white !important; margin-bottom: 2rem !important; }
        .prose h2 { color: #ff5917 !important; font-size: 1.5rem !important; border: none !important; margin-top: 2.5rem !important; margin-bottom: 1rem !important; }
        .prose h3 { color: white !important; font-size: 1.25rem !important; font-weight: 500 !important; margin-top: 1.5rem !important; }
        .prose p { color: #c7cbd8 !important; line-height: 1.8 !important; margin-bottom: 1.25rem !important; }
        .prose strong { color: white !important; font-weight: 700 !important; }
        .prose ul { list-style-type: disc !important; padding-left: 1.5rem !important; margin-bottom: 1.5rem !important; }
        .prose ol { list-style-type: decimal !important; padding-left: 1.5rem !important; margin-bottom: 1.5rem !important; }
        .prose li { color: #c7cbd8 !important; margin-bottom: 0.5rem !important; }

        /* Focus mode typography tuning: Ink */
        .focus-theme-ink #editor-content-to-print p,
        .focus-theme-ink #editor-content-to-print li {
          color: #d4d9e5 !important;
          line-height: 1.9 !important;
        }

        .focus-theme-ink #editor-content-to-print h2 {
          margin-top: 3rem !important;
        }

        /* Focus mode typography tuning: Paper */
        .focus-theme-paper #editor-content-to-print,
        .focus-theme-paper #editor-content-to-print p,
        .focus-theme-paper #editor-content-to-print li,
        .focus-theme-paper #editor-content-to-print blockquote {
          color: #1d2430 !important;
          line-height: 1.85 !important;
        }

        .focus-theme-paper #editor-content-to-print h1.main-title,
        .focus-theme-paper #editor-content-to-print h3,
        .focus-theme-paper #editor-content-to-print strong {
          color: #111827 !important;
        }

        .focus-theme-paper #editor-content-to-print h2 {
          color: #c2410c !important;
          margin-top: 3rem !important;
        }
      `}</style>
    </div>
  );
}
