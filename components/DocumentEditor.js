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

export default function DocumentEditor({ initialHtml, onSave, onCancel, filename, sidebarContent }) {
  const [html, setHtml] = useState(initialHtml);
  const [isTranslating, setIsTranslating] = useState(false);
  const [targetLang, setTargetLang] = useState('German');
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState(false);
  const editorRef = useRef(null);

  const sanitizedHtml = useMemo(() => {
    if (typeof window === 'undefined') return html;
    return DOMPurify.sanitize(html);
  }, [html]);

  useEffect(() => {
    setHtml(initialHtml);
  }, [initialHtml]);

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
    <div className="fixed inset-0 z-[100] bg-dark-bg flex flex-col animate-fade-in print-root">
      {/* Top Navbar */}
      <nav className="h-16 border-b border-white/[0.06] bg-dark-card flex items-center justify-between px-6 shrink-0 no-print">
        <div className="flex items-center gap-4">
          <button onClick={onCancel} className="p-2 text-text-secondary hover:text-accent-orange bg-white/5 rounded-full transition-all">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <div className="flex flex-col">
            <span className="text-[10px] font-bold text-accent-orange uppercase tracking-widest leading-none">Canvas Editor</span>
            <span className="text-sm font-medium text-text-primary truncate max-w-[200px]">{filename}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
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
          <button onClick={handleSave} className={`px-4 py-2 text-xs font-bold rounded-xl transition-all ${saveFeedback ? 'bg-accent-green/20 text-accent-green' : 'text-text-primary hover:bg-white/5'}`}>
            {saveFeedback ? 'Gespeichert!' : 'Speichern'}
          </button>
          <button onClick={handleExportDoc} className="bg-white/5 hover:bg-white/10 text-text-primary px-4 py-1.5 rounded-lg text-xs font-bold border border-white/10">DOCX</button>
          <button onClick={() => window.print()} className="gradient-accent text-white px-5 py-2 rounded-xl text-xs font-bold shadow-lg active:scale-95">PDF</button>
        </div>
      </nav>

      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Reference */}
        {sidebarContent && (
          <aside className="w-72 border-r border-white/[0.06] bg-black/20 overflow-y-auto hidden xl:block no-print group">
            <div className="p-6">
              <h3 className="text-[10px] font-bold text-text-secondary uppercase tracking-[0.2em] mb-6 opacity-50">Referenzmaterial</h3>
              <div className="text-xs text-text-secondary/40 leading-relaxed font-mono select-none group-hover:text-text-secondary/60 transition-colors whitespace-pre-wrap">{sidebarContent}</div>
            </div>
          </aside>
        )}

        <main className="flex-1 overflow-y-auto bg-[#0a0a0f] relative flex flex-col items-center custom-scrollbar print:bg-white print:overflow-visible">
          {/* Formatting Bar - Fixed bottom on mobile, sticky top on desktop */}
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 md:sticky md:top-6 md:bottom-auto md:translate-x-0 mb-4 no-print">
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
          <div className="w-full max-w-[850px] px-4 md:px-8 pb-32 print:p-0 print:w-full print:max-w-none">
            <div 
              id="editor-content-to-print"
              className={`bg-[#16161f] border border-white/[0.04] text-[#e8e8ed] min-h-[300px] md:min-h-[500px] py-10 px-6 md:px-20 shadow-2xl rounded-3xl focus:outline-none prose prose-invert max-w-none print:bg-white print:text-black print:p-[25mm] print:shadow-none print:rounded-none print:border-none print:block ${isTranslating ? 'opacity-50 pointer-events-none' : ''}`}
              contentEditable 
              ref={editorRef} 
              dangerouslySetInnerHTML={{ __html: sanitizedHtml }} 
              onInput={(e) => setHtml(e.currentTarget.innerHTML)}
              spellCheck="false"
            />
          </div>
        </main>
      </div>

      <style jsx global>{`
        /* PRINT LOGIC - NO-PRINT APPROACH */
        @media print {
          @page {
            margin: 0;
            size: portrait;
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
            padding: 25mm 20mm !important; /* Simulated margins */
            margin: 0 !important;
            width: 100% !important;
            max-width: none !important;
            box-shadow: none !important;
            min-height: 100vh !important;
            border: none !important;
            display: block !important;
            visibility: visible !important;
            position: static !important;
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
        .prose p { color: #8b8b9e !important; line-height: 1.8 !important; margin-bottom: 1.25rem !important; }
        .prose strong { color: white !important; font-weight: 700 !important; }
        .prose ul { list-style-type: disc !important; padding-left: 1.5rem !important; margin-bottom: 1.5rem !important; }
        .prose ol { list-style-type: decimal !important; padding-left: 1.5rem !important; margin-bottom: 1.5rem !important; }
        .prose li { color: #8b8b9e !important; margin-bottom: 0.5rem !important; }
      `}</style>
    </div>
  );
}