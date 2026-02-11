import Head from 'next/head';
import { useState, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import { getTemplates, getSettings } from '../lib/api';
import DocumentEditor from '../components/DocumentEditor';
import { analysisToHtml } from '../lib/export-utils';

const LANGUAGES = [
  { code: 'German', label: 'Deutsch' },
  { code: 'English', label: 'Englisch' },
  { code: 'French', label: 'Französisch' },
  { code: 'Spanish', label: 'Spanisch' },
  { code: 'Italian', label: 'Italienisch' },
  { code: 'Chinese', label: 'Chinesisch' },
];

export default function OCR() {
  const { data: session, status } = useSession();
  const router = useRouter();
  
  const [file, setFile] = useState(null);
  const [markdown, setMarkdown] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [transcriptionId, setTranscriptionId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(''); 
  const [analyze, setAnalyze] = useState(true);
  const [error, setError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  
  // Template & Model states
  const [template, setTemplate] = useState('generic');
  const [model, setModel] = useState('mistral-large-latest');
  const [customPrompt, setCustomPrompt] = useState('');
  const [templates, setTemplates] = useState([]);

  // Editor state
  const [showEditor, setShowEditor] = useState(false);

  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
      return;
    }
    if (status === 'authenticated') {
      Promise.all([getTemplates(), getSettings()])
        .then(([templatesData, settingsData]) => {
          setTemplates(templatesData);
        })
        .catch(err => console.error('Error loading options:', err));
    }
  }, [status, router]);

  function handleFile(f) {
    setError('');
    if (!f) return;
    if (f.size > 50 * 1024 * 1024) {
      setError('Datei ist zu groß (max. 50 MB)');
      return;
    }
    setFile(f);
  }

  async function handleSubmit(e) {
    if (e) e.preventDefault();
    if (!file) return;

    setLoading(true);
    setLoadingStep('ocr');
    setError('');
    setMarkdown('');
    setAnalysis(null);
    setTranscriptionId(null);
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('analyze', analyze ? 'true' : 'false');
    
    if (analyze) {
      formData.append('template', template);
      formData.append('model', model);
      if (customPrompt) formData.append('customPrompt', customPrompt);
      setTimeout(() => { if (loading) setLoadingStep('analysis'); }, 8000);
    }

    try {
      const res = await fetch('/api/ocr', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'OCR fehlgeschlagen');
      
      setMarkdown(data.markdown);
      setAnalysis(data.analysis);
      setTranscriptionId(data.transcriptionId);
      
      if (data.analysis || data.markdown) {
        setShowEditor(true);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setLoadingStep('');
    }
  }

  async function handleSaveDocument(html) {
    if (!transcriptionId) return;
    try {
      await fetch(`/api/transcriptions/${transcriptionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentHtml: html }),
      });
      alert('Dokument in Historie gespeichert.');
    } catch {
      alert('Fehler beim Speichern.');
    }
  }

  if (status === 'loading') return null;
  if (!session) return null;

  return (
    <>
      <Head><title>OCR & Document AI - GhostTyper</title></Head>

      {!showEditor ? (
        <div className="max-w-5xl mx-auto animate-fade-in pb-20">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-bold text-text-primary">OCR & Document AI</h1>
              <p className="text-sm text-text-secondary mt-1">Dokumente extrahieren & analysieren</p>
            </div>
          </div>

          <div className="max-w-xl mx-auto space-y-6">
            <div 
              className={`border-2 border-dashed rounded-3xl p-12 text-center transition-all ${
                dragActive ? 'border-accent-orange bg-accent-orange/10 scale-[1.02]' : 'border-white/[0.08] hover:border-white/[0.15] bg-white/[0.02]'
              } ${file ? 'border-accent-green/30 bg-accent-green/5' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => { e.preventDefault(); setDragActive(false); handleFile(e.dataTransfer.files[0]); }}
            >
              <input type="file" ref={fileInputRef} onChange={(e) => handleFile(e.target.files[0])} className="hidden" accept=".pdf,image/*" />
              <input type="file" ref={cameraInputRef} onChange={(e) => handleFile(e.target.files[0])} className="hidden" accept="image/*" capture="environment" />
              
              {file ? (
                <div className="space-y-4">
                  <div className="w-16 h-16 bg-accent-green/20 rounded-2xl flex items-center justify-center mx-auto text-accent-green font-bold text-xl">{file.name.split('.').pop().toUpperCase()}</div>
                  <p className="text-text-primary font-medium">{file.name}</p>
                  <button onClick={() => setFile(null)} className="text-xs text-text-secondary hover:text-accent-red underline">Anderes Dokument</button>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="flex justify-center gap-4">
                    <button 
                      type="button"
                      onClick={() => fileInputRef.current.click()} 
                      className="flex flex-col items-center gap-2 bg-white/[0.05] hover:bg-white/[0.1] text-text-primary px-6 py-4 rounded-2xl border border-white/5 transition-all group w-32"
                      title="Dokument hochladen"
                    >
                      <svg className="w-8 h-8 text-accent-orange group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      <span className="text-[10px] font-bold uppercase tracking-widest">Dokument</span>
                    </button>
                    <button 
                      type="button"
                      onClick={() => cameraInputRef.current.click()} 
                      className="flex flex-col items-center gap-2 bg-white/[0.05] hover:bg-white/[0.1] text-text-primary px-6 py-4 rounded-2xl border border-white/5 transition-all group w-32"
                      title="Foto machen"
                    >
                      <svg className="w-8 h-8 text-accent-orange group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                      <span className="text-[10px] font-bold uppercase tracking-widest">Kamera</span>
                    </button>
                  </div>
                  <p className="text-text-primary font-medium">Dokument hochladen oder fotografieren</p>
                </div>
              )}
            </div>

            <div className="flex flex-col items-center gap-6">
              <label className="flex items-center gap-3 cursor-pointer group">
                <input type="checkbox" checked={analyze} onChange={(e) => setAnalyze(e.target.checked)} className="w-5 h-5 rounded border-white/10 bg-white/5 text-accent-orange focus:ring-accent-orange" />
                <span className="text-sm text-text-secondary group-hover:text-text-primary">Direkt analysieren</span>
              </label>

              {analyze && (
                <div className="w-full max-w-sm space-y-4 bg-white/[0.02] p-4 rounded-xl border border-white/[0.06]">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold text-text-secondary uppercase mb-1.5 ml-1">Modus</label>
                      <select value={template} onChange={(e) => setTemplate(e.target.value)} className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2 text-xs text-text-primary focus:ring-1 focus:ring-accent-orange outline-none">
                        <option value="generic">Zusammenfassung</option><option value="meeting">Meeting</option><option value="aufmass">Aufmaß</option>
                        {templates.map(t => <option key={t.id} value={`custom-${t.id}`}>{t.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-text-secondary uppercase mb-1.5 ml-1">KI-Modell</label>
                      <select value={model} onChange={(e) => setModel(e.target.value)} className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2 text-xs text-text-primary focus:ring-1 focus:ring-accent-orange outline-none">
                        <option value="mistral-large-latest">Mistral Large</option><option value="mistral-medium-latest">Mistral Medium</option><option value="mistral-small-latest">Mistral Small</option>
                      </select>
                    </div>
                  </div>
                  <textarea value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)} placeholder="Zusätzliche Anweisungen..." rows={2} className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2 text-xs text-text-primary focus:ring-1 focus:ring-accent-orange outline-none" />
                </div>
              )}
            </div>

            <button onClick={handleSubmit} disabled={loading || !file} className="w-full gradient-accent text-white py-4 rounded-2xl text-lg font-semibold shadow-lg shadow-accent-orange/20 hover:shadow-accent-orange/30 disabled:opacity-30 flex flex-col items-center justify-center gap-1">
              {loading ? (
                <div className="flex items-center gap-3">
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>{loadingStep === 'ocr' ? 'Schritt 1/2: Text-Extraktion...' : 'Schritt 2/2: KI-Analyse läuft...'}</span>
                </div>
              ) : 'Vorgang starten'}
            </button>
          </div>
        </div>
      ) : (
        <DocumentEditor 
          initialHtml={analysisToHtml({ original_name: file?.name || 'OCR Dokument', created_at: new Date(), text: markdown, analysis: analysis })}
          filename={file?.name || 'ocr-export'}
          sidebarContent={markdown}
          onSave={handleSaveDocument}
          onCancel={() => setShowEditor(false)}
        />
      )}

      {error && <div className="mt-8 p-4 bg-accent-red/10 border border-accent-red/20 text-accent-red rounded-2xl text-sm text-center animate-fade-in">{error}</div>}
    </>
  );
}
