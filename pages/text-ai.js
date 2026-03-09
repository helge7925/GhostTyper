import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import LoadingSpinner from '../components/LoadingSpinner';
import Toast from '../components/Toast';
import DocumentEditor from '../components/DocumentEditor';
import ProcessStatusCard from '../components/ProcessStatusCard';
import { getTextTasks, saveDocument } from '../lib/api';
import { mdToHtml } from '../lib/export-utils';

const TEXT_AI_LOADING_MESSAGES = [
  'Die KI streicht gerade Umwege und bringt den Punkt auf den Punkt.',
  'Wir schütteln den Text kurz durch, bis die beste Version herausfällt.',
  'Virtueller Lektor im Einsatz: präzise, schnell, leicht pedantisch.',
  'Gedanken werden sortiert, bevor sie wieder durcheinanderlaufen.',
  'Wir bügeln gerade Kanten aus dem Text und legen Klarheit drauf.',
  'Fast da: der Feinschliff macht gerade letzte Kniebeugen.',
];

export default function TextAI() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [inputText, setInputText] = useState('');
  const [resultText, setResultText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStartedAt, setLoadingStartedAt] = useState(null);
  const [selectedModel, setSelectedModel] = useState('mistral-small-latest');
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [toast, setToast] = useState(null);
  const [showEditor, setShowEditor] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [activeTaskId, setActiveTaskId] = useState(null);

  useEffect(() => {
    if (status === 'authenticated') {
      getTextTasks()
        .then((tasksData) => {
          setTasks(tasksData);
        })
        .catch(() => {});
    }
  }, [status]);

  if (status === 'loading') return <LoadingSpinner />;
  if (status === 'unauthenticated') {
    router.push('/login');
    return <LoadingSpinner />;
  }

  async function handleAction(taskId) {
    if (!inputText.trim()) {
      setToast({ message: 'Bitte geben Sie zuerst einen Text ein.', type: 'error' });
      return;
    }

    setIsLoading(true);
    setLoadingStartedAt(new Date().toISOString());
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
      setLoadingStartedAt(null);
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
          <div className="mb-8">
            <div>
              <h1 className="text-2xl font-bold text-text-primary">Text-Assistent</h1>
              <p className="text-sm text-text-secondary mt-1">Text korrigieren, umformulieren oder zusammenfassen.</p>
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
                placeholder="Text hier eingeben oder einfügen..."
                className="w-full h-[500px] bg-dark-card border border-white/[0.06] rounded-2xl p-6 text-sm text-text-primary outline-none focus:border-accent-orange/30 resize-none transition-all"
              />
            </div>

            {/* Actions Area */}
            <div className="space-y-6">
              <div className="bg-dark-card border border-white/[0.06] rounded-2xl p-6">
                <h2 className="text-[10px] font-bold text-text-secondary uppercase tracking-widest mb-6">Aktionen</h2>

                <button
                  type="button"
                  onClick={() => setShowAdvancedOptions((prev) => !prev)}
                  className="w-full mb-4 flex items-center justify-between px-4 py-3 rounded-xl border border-white/[0.08] bg-white/[0.02] text-sm text-text-primary hover:bg-white/[0.04] transition-colors"
                  aria-expanded={showAdvancedOptions}
                >
                  <span>Erweiterte Optionen</span>
                  <svg
                    className={`w-4 h-4 text-text-secondary transition-transform ${showAdvancedOptions ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {showAdvancedOptions && (
                  <div className="mb-6 bg-white/[0.02] border border-white/[0.06] rounded-xl p-4">
                    <label className="block text-[10px] font-bold text-text-secondary uppercase tracking-widest mb-2">KI-Modell</label>
                    <select
                      value={selectedModel}
                      onChange={e => setSelectedModel(e.target.value)}
                      className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-text-primary focus:ring-1 focus:ring-accent-orange outline-none"
                    >
                      <option value="mistral-small-latest">Kostengünstig / Schnell</option>
                      <option value="mistral-medium-latest">Ausgewogen</option>
                      <option value="mistral-large-latest">Qualität</option>
                    </select>
                    <p className="mt-2 text-[11px] text-text-secondary">
                      Eine Auswahl reicht: Kostengünstig / Schnell, Ausgewogen oder Qualität.
                    </p>
                  </div>
                )}
                
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
                  <div className="mt-8">
                    <ProcessStatusCard
                      title="Text wird verarbeitet"
                      description="Die ausgewählte Aktion wird ausgeführt."
                      steps={[{ key: 'text-ai', label: 'Antwort wird generiert' }]}
                      activeStep={0}
                      done={false}
                      startedAt={loadingStartedAt}
                      etaSeconds={18}
                      messages={TEXT_AI_LOADING_MESSAGES}
                    />
                  </div>
                )}
              </div>
              
              <div className="px-1">
                <p className="text-xs text-text-secondary/80 leading-relaxed">
                  Wählen Sie eine Aktion. Das Ergebnis wird im Editor geöffnet.
                </p>
                <p className="text-xs text-text-secondary/70 leading-relaxed mt-2">
                  Für kombinierte Abläufe: <Link href="/" className="text-accent-cyan hover:text-accent-orange transition-colors">Dashboard-Presets öffnen</Link>.
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
          sourceLabel="Ausgangstext"
          onSave={handleSaveDocument}
          onCancel={() => setShowEditor(false)}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  );
}
