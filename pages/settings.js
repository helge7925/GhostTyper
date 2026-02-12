import Head from 'next/head';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { useState, useEffect } from 'react';
import { getSettings, updateSettings, getTemplates, createTemplate, updateTemplate, deleteTemplate, generateTemplatePrompt, getTextTasks, createTextTask, updateTextTask, deleteTextTask } from '../lib/api';
import { normalizeDefaultTemplate } from '../lib/constants';
import { DEFAULT_PROMPTS, getPrompt } from '../lib/prompts';

const PRICE_LIST = [
  { model: 'Mistral Large', input: '2,00 €', output: '6,00 €', note: 'Umfangreich' },
  { model: 'Mistral Medium', input: '0,75 €', output: '2,25 €', note: 'Ausgewogen' },
  { model: 'Mistral Small', input: '0,20 €', output: '0,60 €', note: 'Kompakt' },
  { model: 'Mistral Voxtral Mini', input: '0,01 €', output: '0,01 €', note: 'Transkription' },
];

export default function Settings() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [apiKey, setApiKey] = useState('');
  const [defaultTemplate, setDefaultTemplate] = useState('generic');
  const [language, setLanguage] = useState('de');
  const [contextBias, setContextBias] = useState('');
  const [costLimit, setCostLimit] = useState('');
  const [preferredModel, setPreferredModel] = useState('mistral-large-latest');
  const [defaultTranslateLanguage, setDefaultTranslateLanguage] = useState('en');
  const [ocrModel, setOcrModel] = useState('mistral-ocr-latest');
  const [pdfPremiumEnabledDefault, setPdfPremiumEnabledDefault] = useState(false);
  const [pdfPremiumCompany, setPdfPremiumCompany] = useState('');
  const [pdfPremiumName, setPdfPremiumName] = useState('');
  const [pdfPremiumRole, setPdfPremiumRole] = useState('');
  const [pdfPremiumContact, setPdfPremiumContact] = useState('');
  const [pdfPremiumFooter, setPdfPremiumFooter] = useState('');
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [usage, setUsage] = useState(null);

  // Template states
  const [templates, setTemplates] = useState([]);
  const [activeEditor, setActiveEditor] = useState(null); // { id, name, prompt_text, isDefault }
  const [templateLoading, setTemplateLoading] = useState(false);

  // Text Tasks states
  const [textTasks, setTextTasks] = useState([]);
  const [activeTaskEditor, setActiveTaskEditor] = useState(null); // { id, name, prompt, is_favorite }

  const [generatorGoal, setGeneratorGoal] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const [activeTab, setActiveTab] = useState('transcription');

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
      return;
    }
    if (status !== 'authenticated') return;

    const loadData = async () => {
      try {
        const [settingsData, templatesData, tasksData] = await Promise.all([
          getSettings(),
          getTemplates(),
          getTextTasks()
        ]);

        setApiKeyConfigured(settingsData.apiKeyConfigured);
        setDefaultTemplate(normalizeDefaultTemplate(settingsData.defaultTemplate));
        setLanguage(settingsData.language || 'de');
        setContextBias(settingsData.contextBias || '');
        setCostLimit(settingsData.costLimit ?? '');
        setPreferredModel(settingsData.preferredModel || 'mistral-large-latest');
        setDefaultTranslateLanguage(settingsData.defaultTranslateLanguage || 'en');
        setOcrModel(settingsData.ocrModel || 'mistral-ocr-latest');
        setPdfPremiumEnabledDefault(Boolean(settingsData.pdfPremiumEnabledDefault));
        setPdfPremiumCompany(settingsData.pdfPremiumCompany || '');
        setPdfPremiumName(settingsData.pdfPremiumName || '');
        setPdfPremiumRole(settingsData.pdfPremiumRole || '');
        setPdfPremiumContact(settingsData.pdfPremiumContact || '');
        setPdfPremiumFooter(settingsData.pdfPremiumFooter || '');
        setTemplates(templatesData);
        setTextTasks(tasksData);
      } catch (err) {
        console.error('Failed to load settings, templates or tasks:', err);
      } finally {
        setLoading(false);
      }
    };

    loadData();

    fetch('/api/usage')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setUsage(data); })
      .catch(() => {});
  }, [status, router]);

  async function handleSaveSettings(e) {
    if (e) e.preventDefault();
    setError('');
    setSaved(false);

    try {
      await updateSettings({
        mistralApiKey: apiKey || undefined,
        defaultTemplate: normalizeDefaultTemplate(defaultTemplate),
        language,
        contextBias,
        costLimit: costLimit === '' ? null : parseFloat(costLimit),
        preferredModel,
        defaultTranslateLanguage,
        ocrModel,
        pdfPremiumEnabledDefault,
        pdfPremiumCompany,
        pdfPremiumName,
        pdfPremiumRole,
        pdfPremiumContact,
        pdfPremiumFooter,
      });
      setSaved(true);
      if (apiKey) {
        setApiKeyConfigured(true);
        setApiKey('');
      }
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError('Einstellungen konnten nicht gespeichert werden.');
    }
  }

  async function handleGenerateAI() {
    if (!generatorGoal.trim()) return;
    setIsGenerating(true);
    try {
      const { promptText } = await generateTemplatePrompt(generatorGoal);
      setActiveEditor(prev => ({ ...prev, prompt_text: promptText }));
      setGeneratorGoal('');
    } catch (err) {
      alert('Fehler bei der KI-Generierung: ' + err.message);
    } finally {
      setIsGenerating(false);
    }
  }

  // Template Handlers
  async function handleSaveTemplate() {
    if (!activeEditor) return;
    setTemplateLoading(true);

    try {
      if (activeEditor.isDefault) {
        // Standard-Vorlage überschreiben
        const existing = templates.find(t => t.name === activeEditor.id);
        if (existing) {
          const updated = await updateTemplate(existing.id, { name: activeEditor.id, prompt_text: activeEditor.prompt_text });
          setTemplates(templates.map(t => t.id === updated.id ? updated : t));
        } else {
          const created = await createTemplate({ name: activeEditor.id, prompt_text: activeEditor.prompt_text });
          setTemplates([...templates, created]);
        }
      } else if (activeEditor.id === 'new') {
        const created = await createTemplate({ name: activeEditor.name, prompt_text: activeEditor.prompt_text });
        setTemplates([...templates, created]);
      } else {
        const updated = await updateTemplate(activeEditor.id, { name: activeEditor.name, prompt_text: activeEditor.prompt_text });
        setTemplates(templates.map(t => t.id === updated.id ? updated : t));
      }
      setActiveEditor(null);
    } catch (err) {
      alert('Fehler beim Speichern der Vorlage.');
    } finally {
      setTemplateLoading(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm('Vorlage löschen?')) return;
    try {
      await deleteTemplate(id);
      setTemplates(templates.filter(t => t.id !== id));
    } catch {
      alert('Löschen fehlgeschlagen.');
    }
  }

  // Text Task Handlers
  async function handleSaveTask() {
    if (!activeTaskEditor) return;
    setTemplateLoading(true);
    try {
      if (activeTaskEditor.id === 'new') {
        const created = await createTextTask({ 
          name: activeTaskEditor.name, 
          prompt: activeTaskEditor.prompt, 
          is_favorite: activeTaskEditor.is_favorite 
        });
        setTextTasks([...textTasks, created]);
      } else {
        const updated = await updateTextTask(activeTaskEditor.id, activeTaskEditor);
        setTextTasks(textTasks.map(t => t.id === updated.id ? updated : t));
      }
      setActiveTaskEditor(null);
    } catch (err) {
      alert('Fehler beim Speichern der Aufgabe.');
    } finally {
      setTemplateLoading(false);
    }
  }

  async function handleDeleteTask(id) {
    if (!confirm('Aufgabe wirklich löschen?')) return;
    try {
      await deleteTextTask(id);
      setTextTasks(textTasks.filter(t => t.id !== id));
    } catch {
      alert('Löschen fehlgeschlagen.');
    }
  }

  async function handleToggleTaskFavorite(task) {
    try {
      const updated = await updateTextTask(task.id, { is_favorite: !task.is_favorite });
      setTextTasks(textTasks.map(t => t.id === updated.id ? updated : t));
    } catch {
      alert('Favoriten-Status konnte nicht geändert werden.');
    }
  }

  const openDefaultEditor = (key) => {
    const override = templates.find(t => t.name === key);
    setActiveEditor({
      id: key,
      name: key === 'meeting' ? 'Meeting-Protokoll' : key === 'aufmass' ? 'Aufmaß' : 'Zusammenfassung',
      prompt_text: override ? override.prompt_text : getPrompt(key, language),
      isDefault: true
    });
  };

  if (status === 'loading' || loading) return null;

  const TABS = [
    { id: 'transcription', label: 'Transkription', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg> },
    { id: 'analysis', label: 'Analyse', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg> },
    { id: 'tasks', label: 'Text-Assistent', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg> },
    { id: 'ocr-translate', label: 'OCR & Übersetzung', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" /></svg> },
    { id: 'account', label: 'Konto & API', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg> },
  ];

  return (
    <>
      <Head><title>Einstellungen - GhostTyper</title></Head>

      <div className={activeEditor ? 'hidden' : 'max-w-5xl mx-auto animate-fade-in pb-20'}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <h1 className="text-2xl font-bold text-text-primary">Einstellungen</h1>
          {saved && <p className="text-accent-green text-xs animate-pulse bg-accent-green/10 px-3 py-1 rounded-full border border-accent-green/20">Einstellungen gespeichert!</p>}
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 bg-white/5 p-1 rounded-2xl mb-8 overflow-x-auto no-scrollbar border border-white/[0.06]">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === tab.id 
                  ? 'bg-accent-orange text-white shadow-lg shadow-accent-orange/20' 
                  : 'text-text-secondary hover:text-text-primary hover:bg-white/5'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        <div className="space-y-8">
          {activeTab === 'transcription' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-fade-in">
              <div className="bg-dark-card border border-white/[0.06] rounded-2xl p-6 shadow-xl">
                <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-widest mb-6">Transkription</h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1.5">Standardsprache</label>
                    <select value={language} onChange={e => setLanguage(e.target.value)} className="w-full bg-dark-input border border-white/[0.1] rounded-xl px-4 py-2.5 text-sm text-text-primary outline-none">
                      <option value="de">Deutsch</option>
                      <option value="en">Englisch</option>
                      <option value="fr">Französisch</option>
                      <option value="es">Spanisch</option>
                      <option value="it">Italienisch</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1.5">Kontext-Wörter (Context Bias)</label>
                    <textarea value={contextBias} onChange={e => setContextBias(e.target.value)} placeholder="Fachbegriffe, Namen, Abkürzungen..." rows={5} className="w-full bg-dark-input border border-white/[0.1] rounded-xl px-4 py-2.5 text-sm text-text-primary outline-none resize-none" />
                    <p className="mt-2 text-[10px] text-text-secondary italic">Hilft der KI, spezifische Begriffe korrekt zu transkribieren.</p>
                  </div>
                </div>
              </div>
              <div className="space-y-6">
                <div className="bg-dark-card border border-white/[0.06] rounded-2xl p-6 shadow-xl opacity-60">
                  <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-widest mb-4">Modell-Info</h3>
                  <p className="text-xs text-text-secondary leading-relaxed">
                    Für die Transkription wird standardmäßig <strong>Mistral Voxtral Mini</strong> verwendet.
                  </p>
                </div>
                <button onClick={handleSaveSettings} className="w-full gradient-accent text-white py-3.5 rounded-2xl font-semibold shadow-lg shadow-accent-orange/20 transition-all hover:scale-[1.01]">
                  Speichern
                </button>
              </div>
            </div>
          )}

          {activeTab === 'analysis' && (
            <div className="space-y-8 animate-fade-in">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 bg-dark-card border border-white/[0.06] rounded-2xl p-6 shadow-xl">
                  <div className="flex items-center justify-between mb-8">
                    <div>
                      <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-widest">Analyse-Vorlagen</h2>
                      <p className="text-xs text-text-secondary mt-1">Wie soll die KI transkribierte Texte verarbeiten?</p>
                    </div>
                    <button 
                      onClick={() => setActiveEditor({ id: 'new', name: 'Neue Vorlage', prompt_text: '', isDefault: false })} 
                      className="gradient-accent text-white px-5 py-2 rounded-xl text-xs font-bold shadow-lg"
                    >
                      + Neu
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Defaults */}
                    {['meeting', 'aufmass', 'generic'].map(key => (
                      <div key={key} className="flex items-center justify-between p-4 bg-white/5 rounded-xl border border-white/5 group hover:border-accent-orange/30 transition-all">
                        <span className="text-sm font-medium text-text-primary capitalize">
                          {key === 'generic' ? 'Zusammenfassung' : key === 'meeting' ? 'Meeting' : 'Aufmaß'}
                        </span>
                        <button onClick={() => openDefaultEditor(key)} className="text-[10px] font-bold text-accent-orange uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity">Edit</button>
                      </div>
                    ))}
                    {/* Custom */}
                    {templates.filter(t => !['meeting', 'aufmass', 'generic'].includes(t.name)).map(t => (
                      <div key={t.id} className="flex items-center justify-between p-4 bg-white/5 rounded-xl border border-white/5 group hover:border-accent-orange/30 transition-all">
                        <span className="text-sm font-medium text-text-primary truncate pr-4">{t.name}</span>
                        <div className="flex gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => setActiveEditor({...t, isDefault: false})} className="text-[10px] font-bold text-accent-orange uppercase">Edit</button>
                          <button onClick={() => handleDelete(t.id)} className="text-[10px] font-bold text-text-secondary uppercase hover:text-accent-red">Löschen</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="bg-dark-card border border-white/[0.06] rounded-2xl p-6 shadow-xl">
                    <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-widest mb-6">Standard-Modell</h2>
                    <select value={preferredModel} onChange={e => setPreferredModel(e.target.value)} className="w-full bg-dark-input border border-white/[0.1] rounded-xl px-4 py-2.5 text-sm text-text-primary outline-none focus:ring-1 focus:ring-accent-orange">
                      <option value="mistral-large-latest">Mistral Large</option>
                      <option value="mistral-medium-latest">Mistral Medium</option>
                      <option value="mistral-small-latest">Mistral Small</option>
                    </select>
                    <p className="mt-3 text-[10px] text-text-secondary leading-relaxed italic">
                      Dieses Modell wird standardmäßig für die KI-Analyse von Transkripten verwendet.
                    </p>
                  </div>
                  <button onClick={handleSaveSettings} className="w-full gradient-accent text-white py-3.5 rounded-2xl font-semibold shadow-lg shadow-accent-orange/20 transition-all hover:scale-[1.01]">
                    Speichern
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'tasks' && (
            <div className="bg-dark-card border border-white/[0.06] rounded-2xl p-8 shadow-xl animate-fade-in">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-widest">Text-Assistent Aufgaben</h2>
                  <p className="text-xs text-text-secondary mt-1">Verwalten Sie die schnellen KI-Aktionen für den Editor.</p>
                </div>
                <button 
                  onClick={() => setActiveTaskEditor({ id: 'new', name: 'Neue Aufgabe', prompt: '', is_favorite: false })}
                  className="gradient-accent text-white px-5 py-2 rounded-xl text-xs font-bold shadow-lg"
                >
                  + Neue Aufgabe
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {textTasks.map((task) => (
                  <div key={task.id} className="bg-white/5 border border-white/5 rounded-2xl p-5 group hover:border-accent-orange/30 transition-all flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-bold text-text-primary truncate pr-4">{task.name}</span>
                        <button 
                          onClick={() => handleToggleTaskFavorite(task)}
                          className={`transition-colors ${task.is_favorite ? 'text-accent-orange' : 'text-text-secondary/20 hover:text-accent-orange/50'}`}
                        >
                          <svg className="w-4 h-4" fill={task.is_favorite ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.382-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
                        </button>
                      </div>
                      <p className="text-[10px] text-text-secondary line-clamp-2 italic mb-4 opacity-60">&quot;{task.prompt}&quot;</p>
                    </div>
                    <div className="flex items-center gap-3 pt-4 border-t border-white/5">
                      <button onClick={() => setActiveTaskEditor(task)} className="text-[10px] font-bold text-accent-orange uppercase hover:underline">Edit</button>
                      <button onClick={() => handleDeleteTask(task.id)} className="text-[10px] font-bold text-text-secondary uppercase hover:text-accent-red">Löschen</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'ocr-translate' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-fade-in">
              <div className="bg-dark-card border border-white/[0.06] rounded-2xl p-6 shadow-xl">
                <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-widest mb-6">OCR (Texterkennung)</h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1.5">OCR-Modell</label>
                    <select value={ocrModel} onChange={e => setOcrModel(e.target.value)} className="w-full bg-dark-input border border-white/[0.1] rounded-xl px-4 py-2.5 text-sm text-text-primary outline-none">
                      <option value="mistral-ocr-latest">Mistral OCR</option>
                    </select>
                  </div>
                  <p className="text-xs text-text-secondary leading-relaxed italic opacity-70">
                    Mistral OCR ist spezialisiert auf die präzise Textextraktion aus PDF-Dokumenten und Bildern.
                  </p>
                </div>
              </div>
              <div className="bg-dark-card border border-white/[0.06] rounded-2xl p-6 shadow-xl">
                <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-widest mb-6">Übersetzung</h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1.5">Standard-Zielsprache</label>
                    <select value={defaultTranslateLanguage} onChange={e => setDefaultTranslateLanguage(e.target.value)} className="w-full bg-dark-input border border-white/[0.1] rounded-xl px-4 py-2.5 text-sm text-text-primary outline-none">
                      <option value="de">Deutsch</option>
                      <option value="en">Englisch</option>
                      <option value="fr">Französisch</option>
                      <option value="es">Spanisch</option>
                      <option value="it">Italienisch</option>
                    </select>
                  </div>
                  <button onClick={handleSaveSettings} className="w-full gradient-accent text-white py-3.5 rounded-2xl font-semibold shadow-lg shadow-accent-orange/20 transition-all hover:scale-[1.01]">
                    Speichern
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'account' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-fade-in">
              <div className="space-y-6">
                <div className="bg-dark-card border border-white/[0.06] rounded-2xl p-6 shadow-xl">
                  <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-widest mb-6">API-Konfiguration</h2>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1.5">Mistral API-Key</label>
                      <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={apiKeyConfigured ? '••••••••••••••••' : 'Key eingeben'} className="w-full bg-dark-input border border-white/[0.1] rounded-xl px-4 py-2.5 text-sm text-text-primary outline-none focus:ring-1 focus:ring-accent-orange" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1.5">Monatliches Kostenlimit (€)</label>
                      <input type="number" value={costLimit} onChange={e => setCostLimit(e.target.value)} placeholder="Kein Limit" className="w-full bg-dark-input border border-white/[0.1] rounded-xl px-4 py-2.5 text-sm text-text-primary outline-none" />
                    </div>
                  </div>
                </div>
                <div className="bg-dark-card border border-white/[0.06] rounded-2xl p-6 shadow-xl">
                  <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-widest mb-6">PDF-Kopfbereich</h2>
                  <div className="space-y-4">
                    <label className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3">
                      <span className="text-xs font-medium text-text-primary">Kopfbereich standardmäßig aktivieren</span>
                      <input
                        type="checkbox"
                        checked={pdfPremiumEnabledDefault}
                        onChange={(e) => setPdfPremiumEnabledDefault(e.target.checked)}
                        className="h-4 w-4 accent-accent-orange"
                      />
                    </label>
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1.5">Projekt</label>
                      <input
                        type="text"
                        value={pdfPremiumCompany}
                        onChange={(e) => setPdfPremiumCompany(e.target.value)}
                        placeholder="z. B. Produktionsdaten Q2"
                        className="w-full bg-dark-input border border-white/[0.1] rounded-xl px-4 py-2.5 text-sm text-text-primary outline-none"
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-text-secondary mb-1.5">Name</label>
                        <input
                          type="text"
                          value={pdfPremiumName}
                          onChange={(e) => setPdfPremiumName(e.target.value)}
                          placeholder="Vorname Nachname"
                          className="w-full bg-dark-input border border-white/[0.1] rounded-xl px-4 py-2.5 text-sm text-text-primary outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-text-secondary mb-1.5">Rolle</label>
                        <input
                          type="text"
                          value={pdfPremiumRole}
                          onChange={(e) => setPdfPremiumRole(e.target.value)}
                          placeholder="z. B. Projektleitung"
                          className="w-full bg-dark-input border border-white/[0.1] rounded-xl px-4 py-2.5 text-sm text-text-primary outline-none"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1.5">Kontakt</label>
                      <input
                        type="text"
                        value={pdfPremiumContact}
                        onChange={(e) => setPdfPremiumContact(e.target.value)}
                        placeholder="E-Mail, Telefon oder Website"
                        className="w-full bg-dark-input border border-white/[0.1] rounded-xl px-4 py-2.5 text-sm text-text-primary outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1.5">Fußzeile</label>
                      <input
                        type="text"
                        value={pdfPremiumFooter}
                        onChange={(e) => setPdfPremiumFooter(e.target.value)}
                        placeholder="z. B. Vertraulich - nur für den internen Gebrauch"
                        className="w-full bg-dark-input border border-white/[0.1] rounded-xl px-4 py-2.5 text-sm text-text-primary outline-none"
                      />
                    </div>
                  </div>
                </div>
                <button onClick={handleSaveSettings} className="w-full gradient-accent text-white py-3.5 rounded-2xl font-semibold shadow-lg shadow-accent-orange/20 transition-all hover:scale-[1.01]">
                  Speichern
                </button>
              </div>

              {usage && (
                <div className="bg-dark-card border border-white/[0.06] rounded-2xl p-6 shadow-xl relative overflow-hidden">
                  <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-widest mb-6">Verbrauch aktuell</h2>
                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <div className="bg-white/5 rounded-xl p-4 border border-white/5">
                      <p className="text-[10px] text-text-secondary uppercase font-bold tracking-wider mb-1">Kosten</p>
                      <p className="text-2xl font-bold text-accent-orange">{usage.totalCost?.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</p>
                    </div>
                    <div className="bg-white/5 rounded-xl p-4 border border-white/5">
                      <p className="text-[10px] text-text-secondary uppercase font-bold tracking-wider mb-1">Anfragen</p>
                      <p className="text-2xl font-bold text-text-primary">{usage.totalRequests}</p>
                    </div>
                  </div>
                  <div className="space-y-2 border-t border-white/5 pt-4">
                    <h3 className="text-[10px] font-bold text-text-secondary uppercase mb-2 opacity-50">Preisliste (pro 1M Tokens)</h3>
                    {PRICE_LIST.map(p => (
                      <div key={p.model} className="flex items-center justify-between text-[10px]">
                        <span className="text-text-primary">{p.model}</span>
                        <span className="text-text-secondary">In: {p.input} | Out: {p.output}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Text Task Editor Overlay */}
      {activeTaskEditor && (
        <div className="fixed inset-0 z-[110] bg-dark-bg flex flex-col animate-fade-in">
          <header className="h-16 border-b border-white/[0.06] bg-dark-card flex items-center justify-between px-6">
            <div className="flex items-center gap-4">
              <button onClick={() => setActiveTaskEditor(null)} className="p-2 text-text-secondary hover:text-text-primary transition-colors"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg></button>
              <input 
                type="text" 
                value={activeTaskEditor.name} 
                onChange={e => setActiveTaskEditor({...activeTaskEditor, name: e.target.value})} 
                className="bg-transparent border-none text-lg font-semibold text-text-primary outline-none focus:ring-0 w-full max-w-md" 
                placeholder="Name der Aufgabe (z.B. Korrektur)..."
              />
            </div>
            <div className="flex items-center gap-3">
              <button 
                onClick={() => setActiveTaskEditor({...activeTaskEditor, is_favorite: !activeTaskEditor.is_favorite})}
                className={`p-2 rounded-xl transition-colors ${activeTaskEditor.is_favorite ? 'bg-accent-orange/20 text-accent-orange' : 'bg-white/5 text-text-secondary'}`}
                title="Favorit"
              >
                <svg className="w-5 h-5" fill={activeTaskEditor.is_favorite ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.382-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
              </button>
              <button onClick={handleSaveTask} disabled={templateLoading} className="gradient-accent text-white px-6 py-2 rounded-xl text-sm font-bold shadow-lg shadow-accent-orange/20">
                {templateLoading ? 'Speichert...' : 'Aufgabe speichern'}
              </button>
            </div>
          </header>
          <main className="flex-1 p-6 md:p-12 overflow-y-auto bg-black/20">
            <div className="max-w-4xl mx-auto h-full flex flex-col">
              <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest mb-4">Aufgaben-Anweisung (KI-Prompt)</label>
              <textarea 
                value={activeTaskEditor.prompt} 
                onChange={e => setActiveTaskEditor({...activeTaskEditor, prompt: e.target.value})}
                placeholder="Was soll die KI mit dem eingegebenen Text machen?"
                className="flex-1 bg-dark-card border border-white/5 rounded-2xl p-8 text-sm text-text-primary outline-none focus:border-accent-orange/30 shadow-2xl resize-none font-mono leading-relaxed"
              />
              <p className="mt-4 text-[10px] text-text-secondary italic">
                Tipp: Seien Sie präzise. Beispiel: &quot;Korrigiere alle Rechtschreibfehler, aber behalte den Dialekt bei.&quot;
              </p>
            </div>
          </main>
        </div>
      )}

      {/* Canvas Template Editor Overlay */}
      {activeEditor && (
        <div className="fixed inset-0 z-[110] bg-dark-bg flex flex-col animate-fade-in">
          <header className="h-16 border-b border-white/[0.06] bg-dark-card flex items-center justify-between px-6">
            <div className="flex items-center gap-4">
              <button onClick={() => setActiveEditor(null)} className="p-2 text-text-secondary hover:text-text-primary transition-colors"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg></button>
              <input 
                type="text" 
                value={activeEditor.name} 
                onChange={e => setActiveEditor({...activeEditor, name: e.target.value})} 
                disabled={activeEditor.isDefault && ['meeting', 'aufmass', 'generic'].includes(activeEditor.id)} 
                className="bg-transparent border-none text-lg font-semibold text-text-primary outline-none focus:ring-0 w-full max-w-md" 
                placeholder="Name der Vorlage..."
              />
            </div>
            <div className="flex items-center gap-3">
              {activeEditor.isDefault && ['meeting', 'aufmass', 'generic'].includes(activeEditor.id) && <span className="text-[10px] bg-accent-orange/20 text-accent-orange px-2 py-1 rounded-full uppercase">Standard-Vorlage</span>}
              <button onClick={handleSaveTemplate} disabled={templateLoading} className="gradient-accent text-white px-6 py-2 rounded-xl text-sm font-bold shadow-lg shadow-accent-orange/20">
                {templateLoading ? 'Speichert...' : 'Vorlage speichern'}
              </button>
            </div>
          </header>
          <main className="flex-1 p-6 md:p-12 overflow-y-auto bg-black/20">
            <div className="max-w-4xl mx-auto h-full flex flex-col">
              {/* KI Generator Section */}
              <div className="mb-8 bg-dark-card border border-accent-orange/20 rounded-2xl p-6 shadow-2xl shadow-accent-orange/5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-2 h-2 bg-accent-orange rounded-full animate-pulse" />
                  <h3 className="text-[10px] font-bold text-accent-orange uppercase tracking-[0.2em]">Vorlagen-Generator</h3>
                </div>
                <div className="flex gap-3 items-start">
                  <textarea 
                    value={generatorGoal}
                    onChange={e => setGeneratorGoal(e.target.value)}
                    placeholder="Beschreiben Sie hier detailliert, was die Vorlage leisten soll (z.B. 'Ein Protokoll für ein IT-Team-Meeting, das technische Details und Architektur-Entscheidungen hervorhebt')..." 
                    rows={3}
                    className="flex-1 bg-dark-input border border-white/[0.1] rounded-xl px-4 py-2.5 text-sm text-text-primary outline-none focus:ring-1 focus:ring-accent-orange resize-none"
                  />
                  <button 
                    onClick={handleGenerateAI}
                    disabled={isGenerating || !generatorGoal.trim()}
                    className="gradient-accent text-white px-6 py-3 rounded-xl text-xs font-bold shadow-lg disabled:opacity-50 transition-all flex items-center gap-2 shrink-0 h-[46px]"
                  >
                    {isGenerating ? (
                      <>
                        <div className="w-3 h-3 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                        Generiere...
                      </>
                    ) : 'Erstellen'}
                  </button>
                </div>
                <p className="mt-3 text-[10px] text-text-secondary opacity-60">
                  Aus Ihrer Beschreibung wird eine System-Anweisung mit JSON-Struktur erstellt.
                </p>
              </div>

              <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest mb-4">System-Anweisungen (Prompt)</label>
              <textarea 
                value={activeEditor.prompt_text} 
                onChange={e => setActiveEditor({...activeEditor, prompt_text: e.target.value})}
                placeholder="Geben Sie hier die Anweisungen für das Sprachmodell ein..."
                className="flex-1 bg-dark-card border border-white/5 rounded-2xl p-8 text-sm text-text-primary outline-none focus:border-accent-orange/30 shadow-2xl resize-none font-mono leading-relaxed"
              />
              <p className="mt-4 text-[10px] text-text-secondary italic">
                Tipp: Beschreiben Sie exakt, wie das Ergebnis strukturiert sein soll (z.B. als JSON oder Fließtext).
              </p>
            </div>
          </main>
        </div>
      )}
    </>
  );
}
