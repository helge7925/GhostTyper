import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { useState, useEffect, useMemo, useCallback } from 'react';
import StatusBadge from '../../components/StatusBadge';
import LoadingSpinner from '../../components/LoadingSpinner';
import Toast from '../../components/Toast';
import DocumentEditor from '../../components/DocumentEditor';
import { getTranscription, deleteTranscription, updateSpeakers, startAnalysis } from '../../lib/api';
import { STATUS } from '../../lib/constants';
import { analysisToHtml } from '../../lib/export-utils';

const LANGUAGES = [
  { code: 'German', label: 'Deutsch' },
  { code: 'English', label: 'Englisch' },
  { code: 'French', label: 'Französisch' },
  { code: 'Spanish', label: 'Spanisch' },
  { code: 'Chinese', label: 'Chinesisch' },
];

/**
 * Optimized Speaker Input component to prevent full page re-renders on every keystroke
 */
function SpeakerInput({ sid, value, onChange }) {
  const [localValue, setLocalValue] = useState(value);
  
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  return (
    <input 
      type="text" 
      value={localValue || ''} 
      onChange={e => setLocalValue(e.target.value)}
      onBlur={() => onChange(sid, localValue)}
      placeholder={sid} 
      className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-1.5 text-xs text-text-primary outline-none focus:ring-1 focus:ring-accent-orange" 
    />
  );
}

export default function TranscriptionDetail() {
  const router = useRouter();
  const { id } = router.query;
  const { data: session, status: authStatus } = useSession();
  const [transcription, setTranscription] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [speakerNames, setSpeakerNames] = useState({});
  const [savingSpeakers, setSavingSpeakers] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [toast, setToast] = useState(null);

  // Translation state
  const [isTranslating, setIsTranslating] = useState(false);
  const [targetLang, setTargetLang] = useState('German');

  // Editor state
  const [showEditor, setShowEditor] = useState(false);
  const [editorHtml, setEditorHtml] = useState('');

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.push('/login');
      return;
    }
    if (!id || authStatus !== 'authenticated') return;

    getTranscription(id)
      .then((data) => {
        setTranscription(data);
        if (data.speakers) setSpeakerNames(data.speakers);
        if (data.document_html) setEditorHtml(data.document_html);
      })
      .catch(() => setTranscription(null))
      .finally(() => setLoading(false));
  }, [id, authStatus, router]);

  // Poll for updates if processing or analyzing
  useEffect(() => {
    if (!transcription) return;
    const pollingStatuses = [STATUS.PROCESSING, STATUS.ANALYZING];
    if (!pollingStatuses.includes(transcription.status)) return;

    const interval = setInterval(async () => {
      try {
        const updated = await getTranscription(id);
        if (transcription.status === STATUS.PROCESSING && updated.status === STATUS.TRANSCRIBED) {
          setToast({ message: 'Transkription fertig!', type: 'success' });
        }
        setTranscription(updated);
        if (updated.document_html) setEditorHtml(updated.document_html);
        if (!pollingStatuses.includes(updated.status)) clearInterval(interval);
      } catch {}
    }, 5000);
    return () => clearInterval(interval);
  }, [transcription?.status, id]);

  const speakerIds = useMemo(() => {
    if (!transcription?.segments) return [];
    return [...new Set(transcription.segments.map(s => s.speaker_id).filter(Boolean))];
  }, [transcription?.segments]);

  const handleStartAnalysis = useCallback(async () => {
    setAnalyzing(true);
    try {
      await updateSpeakers(id, speakerNames);
      await startAnalysis(id);
      setTranscription(prev => ({ ...prev, status: STATUS.ANALYZING }));
    } catch {
      setAnalyzing(false);
    }
  }, [id, speakerNames]);

  const handleTranslate = useCallback(async () => {
    if (!transcription?.text || isTranslating) return;
    setIsTranslating(true);
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: transcription.text, targetLanguage: targetLang }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      const newText = data.translatedText;
      setTranscription(prev => ({ ...prev, text: newText }));
      await fetch(`/api/transcriptions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: newText }),
      });
      setToast({ message: 'Text übersetzt.', type: 'success' });
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setIsTranslating(false);
    }
  }, [id, transcription?.text, targetLang, isTranslating]);

  const handleSaveDocument = useCallback(async (html) => {
    setEditorHtml(html);
    try {
      await fetch(`/api/transcriptions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentHtml: html }),
      });
      setToast({ message: 'Dokument gespeichert.', type: 'success' });
    } catch {
      setToast({ message: 'Fehler beim Speichern.', type: 'error' });
    }
  }, [id]);

  const handleSpeakerChange = useCallback((sid, name) => {
    setSpeakerNames(prev => ({ ...prev, [sid]: name }));
  }, []);

  const transcriptionHtml = useMemo(() => {
    if (!transcription) return '';
    return editorHtml || analysisToHtml(transcription);
  }, [transcription, editorHtml]);

  if (authStatus === 'loading' || loading) return <LoadingSpinner />;
  if (!transcription) return null;

  const isOCR = transcription.mime_type?.startsWith('image/') || transcription.mime_type === 'application/pdf';
  const typeLabel = isOCR ? 'Dokument' : 'Transkription';
  const rawTextLabel = isOCR ? 'Extrahierter Text' : 'Transkription';

  return (
    <>
      <Head><title>{transcription.original_name} - GhostTyper</title></Head>

      {!showEditor ? (
        <div className="max-w-5xl mx-auto animate-fade-in pb-20">
          <button onClick={() => router.push('/transcriptions')} className="text-text-secondary hover:text-text-primary text-xs flex items-center gap-1 mb-6">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></svg>
            Zurück zur Historie
          </button>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: Info & Actions */}
            <div className="lg:col-span-1 space-y-6">
              <div className="bg-dark-card border border-white/[0.06] rounded-2xl p-6 shadow-xl">
                <StatusBadge status={transcription.status} />
                <h1 className="text-lg font-semibold text-text-primary mt-3 truncate">{transcription.original_name}</h1>
                <p className="text-[10px] text-text-secondary uppercase tracking-widest mt-1">
                  {new Date(transcription.created_at).toLocaleDateString('de-DE')} &bull; {typeLabel}
                </p>
                
                {/* Context & Settings */}
                <div className="mt-6 pt-6 border-t border-white/[0.06] space-y-4">
                  <div>
                    <label className="text-[10px] font-bold text-text-secondary uppercase opacity-50">Analyse-Modus</label>
                    <p className="text-sm text-text-primary capitalize">{transcription.template === 'generic' ? 'Zusammenfassung' : transcription.template}</p>
                  </div>
                  {transcription.custom_prompt && (
                    <div>
                      <label className="text-[10px] font-bold text-text-secondary uppercase opacity-50">Anweisung</label>
                      <p className="text-xs text-text-secondary italic">"{transcription.custom_prompt}"</p>
                    </div>
                  )}
                </div>

                <div className="mt-8 flex flex-col gap-2">
                  <button 
                    onClick={() => {
                      setShowEditor(true);
                    }}
                    disabled={!transcription.text && !transcription.analysis}
                    className="gradient-accent text-white py-2 rounded-xl text-sm font-bold shadow-lg shadow-accent-orange/20 transition-all hover:scale-[1.02] active:scale-100 disabled:opacity-30"
                  >
                    Im Editor öffnen
                  </button>
                  <button onClick={() => { if(confirm(`${typeLabel} wirklich löschen?`)) deleteTranscription(id).then(() => router.push('/transcriptions')) }} className="text-text-secondary hover:text-accent-red py-2 text-xs transition-colors">
                    {typeLabel} löschen
                  </button>
                </div>
              </div>

              {/* Speaker Assignment */}
              {transcription.status === STATUS.TRANSCRIBED && speakerIds.length > 0 && !isOCR && (
                <div className="bg-dark-card border border-white/[0.06] rounded-2xl p-6 shadow-xl">
                  <h3 className="text-xs font-bold text-text-primary uppercase mb-4">Sprecher</h3>
                  <div className="space-y-3">
                    {speakerIds.map(sid => (
                      <SpeakerInput 
                        key={sid} 
                        sid={sid} 
                        value={speakerNames[sid]} 
                        onChange={handleSpeakerChange} 
                      />
                    ))}
                  </div>
                  <button onClick={handleStartAnalysis} disabled={analyzing} className="w-full mt-4 bg-white/5 hover:bg-white/10 text-text-primary py-2 rounded-xl text-xs font-bold border border-white/[0.06] transition-all">
                    {analyzing ? 'Analyse läuft...' : 'Analyse starten'}
                  </button>
                </div>
              )}
            </div>

            {/* Right: Preview Area */}
            <div className="lg:col-span-2 space-y-6">
              {/* Raw Text with Translation */}
              <div className="bg-dark-card border border-white/[0.06] rounded-2xl p-6 shadow-xl">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xs font-bold text-text-primary uppercase tracking-widest opacity-50">{rawTextLabel}</h2>
                  {transcription.text && transcription.status === STATUS.TRANSCRIBED && (
                    <div className="flex items-center gap-2">
                      <select value={targetLang} onChange={e => setTargetLang(e.target.value)} className="bg-white/5 border border-white/[0.1] text-[10px] text-text-primary rounded px-1 py-0.5 outline-none">
                        {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                      </select>
                      <button onClick={handleTranslate} disabled={isTranslating} className="text-[10px] text-accent-orange hover:underline underline-offset-2">
                        {isTranslating ? 'Übersetze...' : 'Übersetzen'}
                      </button>
                    </div>
                  )}
                </div>
                <div className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap max-h-[400px] overflow-y-auto pr-2 custom-scrollbar font-mono opacity-80">
                  {transcription.text || 'Warte auf Text...'}
                </div>
              </div>

              {/* Analysis Preview */}
              {transcription.analysis && (
                <div className="bg-dark-card border border-accent-orange/20 rounded-2xl p-6 shadow-2xl shadow-accent-orange/5">
                  <h2 className="text-xs font-bold text-accent-orange uppercase tracking-widest mb-4">KI-Ergebnis</h2>
                  <div className="space-y-4">
                    {transcription.analysis.zusammenfassung && (
                      <p className="text-sm text-text-primary leading-relaxed italic border-l-2 border-accent-orange/30 pl-4">{transcription.analysis.zusammenfassung}</p>
                    )}
                    <button 
                      onClick={() => {
                        setShowEditor(true);
                      }}
                      className="text-xs text-accent-orange hover:text-accent-cyan transition-colors font-bold flex items-center gap-1"
                    >
                      Vollständige Analyse im Editor bearbeiten &rarr;
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <DocumentEditor 
          initialHtml={transcriptionHtml}
          filename={transcription.original_name}
          sidebarContent={transcription.text}
          onSave={handleSaveDocument}
          onCancel={() => setShowEditor(false)}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  );
}