import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import LoadingSpinner from '../components/LoadingSpinner';
import Toast from '../components/Toast';
import DocumentEditor from '../components/DocumentEditor';
import { getTextTasks, saveDocument } from '../lib/api';
import { mdToHtml } from '../lib/export-utils';

export default function TextAI() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [inputText, setInputText] = useState('');
  const [resultText, setResultText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState('mistral-small-latest');
  const [toast, setToast] = useState(null);
  const [showEditor, setShowEditor] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [activeTaskId, setActiveTaskId] = useState(null);

  useEffect(() => {
    if (status === 'authenticated') {
      getTextTasks().then(setTasks).catch(() => {});
    }
  }, [status]);

  if (status === 'loading') return <LoadingSpinner />;
  if (status === 'unauthenticated') {
    router.push('/login');
    return null;
  }

  async function handleAction(taskId) {
    if (!inputText.trim()) {
      setToast({ message: 'Bitte geben Sie zuerst einen Text ein.', type: 'error' });
      return;
    }

    setIsLoading(true);
    setActiveTaskId(taskId);
    
    try {
      const res = await fetch('/api/text-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: inputText,
          action: taskId,
          model: selectedModel
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message);

      setResultText(data.resultText);
      setShowEditor(true);
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSaveDocument(html) {
    try {
      const task = tasks.find(t => t.id === activeTaskId);
      const taskName = task ? task.name : 'Text-Assistent';
      await saveDocument({
        title: `${taskName} (${new Date().toLocaleDateString('de-DE')})`,
        text: inputText,
        documentHtml: html,
        template: 'text-assistant'
      });
      setToast({ message: 'Ergebnis in Historie gespeichert!', type: 'success' });
      return Promise.resolve();
    } catch (err) {
      setToast({ message: 'Fehler beim Speichern: ' + err.message, type: 'error' });
      return Promise.reject(err);
    }
  }

  return (
    <>
      <Head>
        <title>Text-Assistent - GhostTyper</title>
      </Head>

      {!showEditor ? (
        <div className="max-w-6xl mx-auto animate-fade-in pb-20">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-bold text-text-primary">Text-Assistent</h1>
              <p className="text-sm text-text-secondary mt-1">Intelligente Textkorrektur, Umformulierung und Analyse.</p>
            </div>
            
            <div className="flex items-center gap-3 bg-dark-card border border-white/[0.06] rounded-xl px-4 py-2">
              <span className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Modell</span>
              <select 
                value={selectedModel} 
                onChange={e => setSelectedModel(e.target.value)}
                className="bg-transparent text-sm text-accent-orange font-medium outline-none cursor-pointer"
              >
                <option value="mistral-small-latest">Mistral Small (Günstig)</option>
                <option value="mistral-medium-latest">Mistral Medium (Besser)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Input Area */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Eingabe</label>
                <button 
                  onClick={() => setInputText('')}
                  className="text-[10px] text-text-secondary hover:text-accent-red transition-colors"
                >
                  Leeren
                </button>
              </div>
              <textarea
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                placeholder="Fügen Sie hier Ihren Text ein, den Sie korrigieren oder bearbeiten möchten..."
                className="w-full h-[500px] bg-dark-card border border-white/[0.06] rounded-2xl p-6 text-sm text-text-primary outline-none focus:border-accent-orange/30 shadow-xl resize-none transition-all"
              />
            </div>

            {/* Actions Area */}
            <div className="space-y-6">
              <div className="bg-dark-card border border-white/[0.06] rounded-2xl p-6 shadow-xl">
                <h2 className="text-[10px] font-bold text-text-secondary uppercase tracking-widest mb-6">Aktionen</h2>
                
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {tasks.map((task) => (
                    <button
                      key={task.id}
                      onClick={() => handleAction(task.id)}
                      disabled={isLoading}
                      className={`px-3 py-2.5 border rounded-xl text-[11px] font-medium transition-all text-left flex items-center gap-2 group disabled:opacity-50 ${task.is_favorite ? 'bg-accent-orange/10 border-accent-orange/30 text-accent-orange' : 'bg-white/5 border-white/5 text-text-primary hover:border-accent-orange/30 hover:bg-accent-orange/5'}`}
                    >
                      <div className={`w-1.5 h-1.5 rounded-full ${task.is_favorite ? 'bg-accent-orange' : 'bg-text-secondary group-hover:bg-accent-orange'} group-hover:animate-pulse`} />
                      {task.name}
                    </button>
                  ))}
                </div>

                {isLoading && (
                  <div className="mt-8 flex flex-col items-center gap-3 animate-fade-in">
                    <div className="w-8 h-8 border-2 border-accent-orange/20 border-t-accent-orange rounded-full animate-spin" />
                    <span className="text-[10px] text-text-secondary animate-pulse uppercase tracking-widest">KI denkt nach...</span>
                  </div>
                )}
              </div>
              
              <div className="bg-dark-card border border-white/[0.06] rounded-2xl p-6 opacity-50">
                <p className="text-xs text-text-secondary leading-relaxed">
                  Wählen Sie eine Aktion aus, um den Text zu verarbeiten. Das Ergebnis wird direkt im professionellen Editor geöffnet.
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <DocumentEditor 
          initialHtml={mdToHtml(resultText)}
          filename="text-assistent-ergebnis"
          sidebarContent={inputText}
          onSave={handleSaveDocument}
          onCancel={() => setShowEditor(false)}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  );
}
