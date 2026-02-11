import Head from 'next/head';
import { useState, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import { exportToDoc, mdToHtml } from '../lib/export-utils';
import DocumentEditor from '../components/DocumentEditor';
import { saveDocument } from '../lib/api';

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
  
  const [text, setText] = useState('');
  const [targetLanguage, setTargetLanguage] = useState('German');
  const [model, setModel] = useState('mistral-large-latest');
  const [translatedText, setTranslatedText] = useState('');
  const [loading, setLoading] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [error, setError] = useState('');

  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  const handleOcr = async (file) => {
    if (!file) return;
    setOcrLoading(true);
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
    }
  };

  async function handleTranslate(e) {
    if (e) e.preventDefault();
    if (!text.trim()) return;

    setLoading(true);
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
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveDocument(html) {
    try {
      await saveDocument({
        title: `Übersetzung: ${targetLanguage} (${new Date().toLocaleDateString('de-DE')})`,
        text: text,
        documentHtml: html,
        template: 'translation'
      });
      return Promise.resolve();
    } catch (err) {
      setError('Fehler beim Speichern: ' + err.message);
      return Promise.reject(err);
    }
  }

  if (status === 'loading') return null;
  if (!session) return null;

  return (
    <>
      <Head><title>Übersetzung - GhostTyper</title></Head>

      {!translatedText ? (
        <div className="max-w-5xl mx-auto pb-20 px-2 sm:px-0 animate-fade-in">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
            <div>
              <h1 className="text-2xl font-bold text-text-primary">Übersetzung</h1>
              <p className="text-sm text-text-secondary mt-1">Präzise Texte übersetzen & Dokumente scannen</p>
            </div>
            
            <div className="flex items-center gap-3 bg-dark-card border border-white/[0.06] rounded-2xl px-4 py-2 text-white shadow-xl w-fit">
              <span className="text-[10px] font-bold text-text-secondary uppercase tracking-widest opacity-50">KI-Modell:</span>
              <select value={model} onChange={e => setModel(e.target.value)} className="bg-transparent text-xs text-text-primary outline-none cursor-pointer border-none p-0">
                <option value="mistral-large-latest">Mistral Large</option>
                <option value="mistral-medium-latest">Mistral Medium</option>
                <option value="mistral-small-latest">Mistral Small</option>
              </select>
            </div>
          </div>

          <div className="space-y-6">
            {/* Input Area */}
            <div className="space-y-4">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-bold text-text-secondary uppercase tracking-wider">Eingabetext</span>
                <div className="flex items-center gap-2">
                  <input type="file" ref={fileInputRef} onChange={e => handleOcr(e.target.files[0])} accept=".pdf,image/*" className="hidden" />
                  <input type="file" ref={cameraInputRef} onChange={e => handleOcr(e.target.files[0])} accept="image/*" capture="environment" className="hidden" />
                  
                  <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-text-primary px-4 py-2 rounded-xl text-xs font-bold border border-white/5 transition-all" title="Dokument hochladen">
                    <svg className="w-5 h-5 text-accent-orange" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    <span className="hidden sm:inline">Dokument</span>
                  </button>
                  <button onClick={() => cameraInputRef.current?.click()} className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-text-primary px-4 py-2 rounded-xl text-xs font-bold border border-white/5 transition-all" title="Foto machen">
                    <svg className="w-5 h-5 text-accent-orange" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    <span className="hidden sm:inline">Kamera</span>
                  </button>
                  <button onClick={() => setText('')} className="p-2 text-text-secondary hover:text-accent-red bg-white/5 rounded-xl transition-colors"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></svg></button>
                </div>
              </div>
              
              <div className={`bg-dark-card border border-white/[0.06] rounded-3xl overflow-hidden focus-within:border-accent-orange/30 transition-all shadow-2xl relative ${ocrLoading || loading ? 'opacity-50' : ''}`}>
                {(ocrLoading || loading) && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="w-10 h-10 border-2 border-accent-orange border-t-transparent rounded-full animate-spin mb-3" />
                    <span className="text-xs font-bold text-accent-orange uppercase tracking-widest">{ocrLoading ? 'Extrahiere Text...' : 'Übersetze...'}</span>
                  </div>
                )}
                <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Text hier einfügen oder Dokument oben scannen..." className="w-full h-[400px] bg-transparent p-8 text-text-primary placeholder-text-secondary/20 outline-none resize-none text-base leading-relaxed custom-scrollbar" />
              </div>
            </div>

            {/* Language Selection & Action */}
            <div className="flex flex-col items-center gap-6 py-4">
              <div className="flex items-center gap-4 bg-dark-card border border-white/[0.06] rounded-2xl px-6 py-3 shadow-xl">
                <span className="text-xs font-bold text-text-secondary uppercase tracking-widest">Zielsprache:</span>
                <select value={targetLanguage} onChange={(e) => setTargetLanguage(e.target.value)} className="bg-white/5 border border-white/10 text-accent-orange font-bold text-sm rounded-xl px-4 py-2 outline-none hover:bg-white/10 transition-all cursor-pointer">
                  {LANGUAGES.map(lang => <option key={lang.code} value={lang.code}>{lang.label}</option>)}
                </select>
              </div>

              <button onClick={handleTranslate} disabled={loading || ocrLoading || !text.trim()} className="w-full max-w-md gradient-accent text-white py-4 rounded-2xl text-lg font-bold shadow-lg shadow-accent-orange/20 hover:shadow-accent-orange/40 disabled:opacity-30 transition-all hover:scale-[1.02] active:scale-95">
                {loading ? 'Wird übersetzt...' : 'Übersetzung starten'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <DocumentEditor 
          initialHtml={mdToHtml(translatedText)}
          filename={`Uebersetzung_${targetLanguage}`}
          sidebarContent={text}
          onSave={handleSaveDocument}
          onCancel={() => setTranslatedText('')}
        />
      )}

      {error && <div className="mt-8 p-4 bg-accent-red/10 border border-accent-red/20 text-accent-red rounded-2xl text-sm text-center animate-fade-in shadow-xl mx-auto max-w-5xl">{error}</div>}
    </>
  );
}
