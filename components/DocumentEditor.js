import { useState, useRef, useEffect, useMemo } from 'react';
import { exportToDoc } from '../lib/export-utils';
import DOMPurify from 'dompurify';

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
  const [focusMode, setFocusMode] = useState(false);
  const [focusPreset, setFocusPreset] = useState('paper');
  const [showSourceContent, setShowSourceContent] = useState(false);
  const editorRef = useRef(null);

  const sanitizedHtml = useMemo(() => {
    if (typeof window === 'undefined') return html;
    return DOMPurify.sanitize(html);
  }, [html]);

  useEffect(() => {
    setHtml(initialHtml);
  }, [initialHtml]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && focusMode) {
        setFocusMode(false);
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

  const handleSave = async () => {
    const currentHtml = editorRef.current?.innerHTML || html;
    try {
      await onSave(currentHtml);
      setSaveFeedback(true);
      setTimeout(() => setSaveFeedback(false), 2000);
    } catch (err) {
      console.error('Failed to save!', err);
    }
  };

  const handleExportDoc = () => {
    const currentHtml = editorRef.current?.innerHTML || html;
    exportToDoc(currentHtml, filename);
  };

  const openPdfBlob = (blob) => {
    const url = window.URL.createObjectURL(blob);
    const opened = window.open(url, '_blank', 'noopener,noreferrer');

    if (!opened) {
      window.URL.revokeObjectURL(url);
      alert('PDF konnte nicht in einem neuen Tab geöffnet werden. Bitte Pop-ups für diese Seite erlauben.');
      return;
    }

    // Give the new tab enough time to load the blob before revoking.
    window.setTimeout(() => {
      window.URL.revokeObjectURL(url);
    }, 60_000);
  };

  const getPdfThemeTokens = () => {
    return {
      text: '#1f2a37',
      muted: '#5b6573',
      heading: '#16202d',
      accent: '#d66136',
      border: 'rgba(22, 32, 45, 0.12)',
      blockBg: '#f5f3ef',
    };
  };

  const getPdfFontFamily = () => {
    return '"Inter", "Source Sans 3", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  };

  const getPdfFontImport = () => {
    return "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Sans+3:wght@400;600;700&display=swap');";
  };

  const buildPdfPrintStyles = () => {
    const tokens = getPdfThemeTokens();
    const fontFamily = getPdfFontFamily();
    const fontImport = getPdfFontImport();

    return `
      ${fontImport}
      @page { size: A4 portrait; margin: 18mm 16mm 20mm 16mm; }
      :root {
        --pdf-text: ${tokens.text};
        --pdf-muted: ${tokens.muted};
        --pdf-heading: ${tokens.heading};
        --pdf-accent: ${tokens.accent};
        --pdf-border: ${tokens.border};
        --pdf-block-bg: ${tokens.blockBg};
      }
      html, body { margin: 0; padding: 0; background: #fff; color: var(--pdf-text); }
      body {
        font-family: ${fontFamily};
        font-size: 11.5pt;
        line-height: 1.68;
        text-rendering: optimizeLegibility;
      }
      #print-root { width: 100%; color: var(--pdf-text); overflow-wrap: anywhere; }
      #print-root h1, #print-root h2, #print-root h3, #print-root h4 { color: var(--pdf-heading); letter-spacing: 0.01em; }
      #print-root h1, #print-root h2, #print-root h3 { page-break-after: avoid; break-after: avoid-page; page-break-inside: avoid; break-inside: avoid-page; }
      #print-root h1 {
        font-size: 1.7rem;
        margin: 0 0 1rem;
        padding-bottom: 0.45rem;
        border-bottom: 1px solid var(--pdf-border);
      }
      #print-root h2 { font-size: 1.22rem; margin: 1.75rem 0 0.65rem; color: var(--pdf-accent); }
      #print-root h3 { font-size: 1.06rem; margin: 1.25rem 0 0.45rem; color: var(--pdf-heading); }
      #print-root h1 + *, #print-root h2 + *, #print-root h3 + * { page-break-before: avoid; break-before: avoid-page; }
      #print-root p {
        margin: 0 0 0.75em;
        color: var(--pdf-text);
        page-break-inside: auto;
        break-inside: auto;
        orphans: 3;
        widows: 3;
        hyphens: auto;
      }
      #print-root strong { color: var(--pdf-heading); }
      #print-root ul, #print-root ol { margin: 0 0 0.9em; padding-left: 1.35em; }
      #print-root li { margin: 0 0 0.3em; color: var(--pdf-text); page-break-inside: auto; break-inside: auto; }
      #print-root li::marker { color: var(--pdf-accent); }
      #print-root a { color: var(--pdf-accent); text-decoration: underline; }
      #print-root blockquote {
        margin: 1em 0;
        padding: 0.55em 0.9em;
        border-left: 3px solid var(--pdf-accent);
        background: var(--pdf-block-bg);
        color: var(--pdf-muted);
      }
      #print-root code, #print-root pre {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      }
      #print-root pre {
        background: var(--pdf-block-bg);
        padding: 0.65em 0.8em;
        border-radius: 8px;
        border: 1px solid var(--pdf-border);
      }
      #print-root blockquote, #print-root pre, #print-root table, #print-root tr, #print-root img, #print-root figure {
        page-break-inside: avoid;
        break-inside: avoid-page;
      }
      #print-root table {
        width: 100%;
        border-collapse: collapse;
        margin: 0.55em 0 1em;
        border: 1px solid var(--pdf-border);
        border-radius: 8px;
        overflow: hidden;
      }
      #print-root th, #print-root td {
        border: 1px solid var(--pdf-border);
        padding: 0.38em 0.5em;
        vertical-align: top;
        text-align: left;
      }
      #print-root th { color: var(--pdf-heading); background: var(--pdf-block-bg); }
      #print-root tbody tr:nth-child(even) { background: #fcfbf9; }
      #print-root hr { border: none; border-top: 1px solid var(--pdf-border); margin: 1.1em 0; }
    `;
  };

  const handleExportPdfLegacy = () => {
    const currentHtml = editorRef.current?.innerHTML || html;
    const printableHtml = DOMPurify.sanitize(currentHtml || '', { USE_PROFILES: { html: true } });
    const printStyles = buildPdfPrintStyles();
    const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=1024,height=900');

    if (!printWindow) {
      alert('PDF-Export wurde vom Browser blockiert. Bitte Pop-ups für diese Seite erlauben.');
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
      openPdfBlob(blob);
    } catch (error) {
      const shouldUseBrowserFallback = window.confirm(
        'Der serverseitige PDF-Export ist gerade nicht verfügbar. Browser-Export als Fallback starten?'
      );
      if (shouldUseBrowserFallback) {
        handleExportPdfLegacy();
      }
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleTranslateAction = async () => {
    const currentHtml = editorRef.current?.innerHTML || html;
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
      setHtml(data.translatedText);
    } catch (err) {
      alert('Fehler bei der Übersetzung: ' + err.message);
    } finally {
      setIsTranslating(false);
    }
  };

  return (
    <div className={`fixed inset-0 z-[100] bg-dark-bg flex flex-col animate-fade-in print-root ${focusMode ? `focus-mode focus-theme-${focusPreset}` : ''}`}>
      {/* Top Navbar */}
      <nav className={`min-h-16 border-b flex flex-wrap md:flex-nowrap items-center justify-between gap-2 px-3 md:px-6 py-2 md:py-0 shrink-0 no-print ${
        focusMode
          ? focusPreset === 'paper'
            ? 'bg-[#f3f2ee]/88 border-black/[0.08] backdrop-blur-md md:min-h-14 md:px-8'
            : 'bg-[#0b0b10]/85 border-white/[0.04] backdrop-blur-md md:min-h-14 md:px-8'
          : 'bg-dark-card border-white/[0.06]'
      }`}>
        <div className="flex items-center gap-3 md:gap-4 min-w-0">
          <button onClick={onCancel} className={`p-2 rounded-full transition-all ${
            focusMode
              ? focusPreset === 'paper'
                ? 'text-black/60 hover:text-black bg-black/[0.04]'
                : 'text-text-secondary hover:text-text-primary bg-white/[0.04]'
              : 'text-text-secondary hover:text-accent-orange bg-white/5'
          }`}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          {!focusMode && (
            <div className="flex flex-col">
              <span className="text-[10px] font-bold text-accent-orange uppercase tracking-widest leading-none">Editor</span>
              <span className="text-sm font-medium text-text-primary truncate max-w-[200px]">{filename}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 md:gap-3 w-full md:w-auto justify-end overflow-x-auto no-scrollbar">
          {focusMode && (
            <div className={`flex items-center rounded-lg p-0.5 border ${
              focusPreset === 'paper'
                ? 'bg-black/[0.04] border-black/[0.08]'
                : 'bg-white/[0.05] border-white/[0.08]'
            }`}>
              <button
                onClick={() => setFocusPreset('paper')}
                className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-colors ${
                  focusPreset === 'paper'
                    ? 'bg-white text-black'
                    : focusPreset === 'ink'
                      ? 'text-text-secondary hover:text-text-primary'
                      : 'text-black/60 hover:text-black'
                }`}
              >
                Hell
              </button>
              <button
                onClick={() => setFocusPreset('ink')}
                className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-colors ${
                  focusPreset === 'ink'
                    ? 'bg-[#1a1b22] text-white'
                    : focusPreset === 'paper'
                      ? 'text-black/60 hover:text-black'
                      : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                Dunkel
              </button>
            </div>
          )}

          {!focusMode && (
            <>
              <div className="flex items-center gap-2 bg-white/5 rounded-xl px-2 py-1 border border-white/5">
                <select value={targetLang} onChange={e => setTargetLang(e.target.value)} className="bg-transparent text-[10px] text-text-primary outline-none cursor-pointer">
                  {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                </select>
                <button onClick={handleTranslateAction} disabled={isTranslating} className="text-[10px] font-bold text-accent-orange hover:text-white transition-colors uppercase tracking-wider px-2">
                  {isTranslating ? '...' : 'Übersetzen'}
                </button>
              </div>
              <div className="w-px h-6 bg-white/10 mx-1" />
              <button onClick={handleCopy} className={`px-4 py-2 text-xs font-bold rounded-xl transition-all ${copyFeedback ? 'bg-accent-green/20 text-accent-green' : 'text-text-primary hover:bg-white/5'}`}>
                {copyFeedback ? 'Kopiert!' : 'Kopieren'}
              </button>
            </>
          )}
          <button onClick={handleSave} className={`px-4 py-2 text-xs font-bold rounded-xl transition-all ${
            saveFeedback
              ? 'bg-accent-green/20 text-accent-green'
              : focusMode
                ? focusPreset === 'paper'
                  ? 'text-black hover:bg-black/[0.05] border border-black/[0.08]'
                  : 'text-text-primary hover:bg-white/[0.04] border border-white/[0.06]'
                : 'text-text-primary hover:bg-white/5'
          }`}>
            {saveFeedback ? 'Gespeichert!' : 'Speichern'}
          </button>
          <button onClick={handleExportDoc} className={`text-text-primary px-4 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
            focusMode
              ? focusPreset === 'paper'
                ? 'bg-black/[0.03] hover:bg-black/[0.06] border-black/[0.08] text-black'
                : 'bg-white/[0.03] hover:bg-white/[0.06] border-white/[0.08]'
              : 'bg-white/5 hover:bg-white/10 border-white/10'
          }`}>DOCX</button>
          <label className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[10px] font-bold uppercase tracking-wide ${
            focusMode
              ? focusPreset === 'paper'
                ? 'border-black/[0.12] bg-black/[0.03] text-black/80'
                : 'border-white/[0.10] bg-white/[0.03] text-text-secondary'
              : 'border-white/10 bg-white/5 text-text-secondary'
          }`}>
            <input
              type="checkbox"
              checked={pdfPremiumEnabled}
              onChange={(e) => setPdfPremiumEnabled(e.target.checked)}
              className="h-3.5 w-3.5 accent-accent-orange"
            />
            Kopfbereich
          </label>
          <button
            onClick={handleExportPdf}
            disabled={isExportingPdf}
            className="gradient-accent text-white px-5 py-2 rounded-xl text-xs font-bold shadow-lg active:scale-95 disabled:opacity-50"
          >
            {isExportingPdf ? 'PDF...' : 'PDF'}
          </button>
          <button
            onClick={() => setFocusMode((prev) => !prev)}
            className={`px-4 py-2 text-xs font-bold rounded-xl transition-all ${
              focusMode
                ? focusPreset === 'paper'
                  ? 'bg-black/10 text-black border border-black/20'
                  : 'bg-accent-orange/20 text-accent-orange border border-accent-orange/30'
                : 'text-text-primary hover:bg-white/5'
            }`}
          >
            {focusMode ? 'Fokus beenden' : 'Fokus'}
          </button>
        </div>
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
              onInput={(e) => setHtml(e.currentTarget.innerHTML)}
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
