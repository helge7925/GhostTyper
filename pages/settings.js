import Head from 'next/head';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { useState, useEffect } from 'react';
import LoadingSpinner from '../components/LoadingSpinner';
import Toast from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';
import {
  getSettings,
  updateSettings,
  getTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  generateTemplatePrompt,
  getTextTasks,
  createTextTask,
  updateTextTask,
  deleteTextTask,
  getTemplateCategories,
  createTemplateCategory,
  updateTemplateCategory,
  deleteTemplateCategory,
  getGlossarySuggestions,
  getWorkflows,
  saveWorkflow,
  getWorkflowVersions,
  rollbackWorkflowVersion,
  deleteWorkflow,
  getAuditLog,
} from '../lib/api';
import { normalizeDefaultTemplate } from '../lib/constants';
import { DEFAULT_PROMPTS, getPrompt } from '../lib/prompts';
import TableSchemaBuilder from '../components/TableSchemaBuilder';
import { validateTableSchema, buildTableExtractionPrompt } from '../lib/table-calculations';
import { useUiFeedback } from '../lib/use-ui-feedback';

const PRICE_LIST = [
  { model: 'Mistral Large', input: '2,00 €', output: '6,00 €', note: 'Umfangreich' },
  { model: 'Mistral Medium', input: '0,75 €', output: '2,25 €', note: 'Ausgewogen' },
  { model: 'Mistral Small', input: '0,20 €', output: '0,60 €', note: 'Kompakt' },
  { model: 'Mistral Voxtral Mini', input: '0,01 €', output: '0,01 €', note: 'Transkription' },
];

const SETTINGS_TAB_IDS = ['transcription', 'analysis', 'tasks', 'ocr-translate', 'account'];
const DEFAULT_TEXT_TEMPLATE_OPTIONS = [
  { key: 'meeting', label: 'Meeting-Protokoll' },
  { key: 'aufmass', label: 'Aufmaß' },
  { key: 'generic', label: 'Zusammenfassung' },
];

function parseContextTerms(rawValue) {
  if (!rawValue || typeof rawValue !== 'string') return [];

  const terms = rawValue
    .split(/[\n,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  const seen = new Set();
  const unique = [];
  for (const term of terms) {
    const key = term.toLocaleLowerCase('de-DE');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(term);
  }
  return unique;
}

export default function Settings() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [apiKey, setApiKey] = useState('');
  const [defaultTemplate, setDefaultTemplate] = useState('generic');
  const [language, setLanguage] = useState('de');
  const [contextBias, setContextBias] = useState('');
  const [costLimit, setCostLimit] = useState('');
  const [memberMonthlyBudgetLimit, setMemberMonthlyBudgetLimit] = useState('');
  const [preferredModel, setPreferredModel] = useState('mistral-large-latest');
  const [defaultTranslateLanguage, setDefaultTranslateLanguage] = useState('en');
  const [ocrModel, setOcrModel] = useState('mistral-ocr-latest');
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isClearingMistralKey, setIsClearingMistralKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [usage, setUsage] = useState(null);

  // Template states
  const [templates, setTemplates] = useState([]);
  const [templateCategories, setTemplateCategories] = useState([]);
  const [activeEditor, setActiveEditor] = useState(null);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingCategoryId, setEditingCategoryId] = useState(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');

  // Table Template states
  const [tableTemplateEditor, setTableTemplateEditor] = useState(null);
  const [tableSchema, setTableSchema] = useState(null);

  // Text Tasks states
  const [textTasks, setTextTasks] = useState([]);
  const [activeTaskEditor, setActiveTaskEditor] = useState(null);
  const [customWorkflows, setCustomWorkflows] = useState([]);
  const [activeWorkflowEditor, setActiveWorkflowEditor] = useState(null);
  const [workflowVersions, setWorkflowVersions] = useState([]);
  const [workflowVersionLoading, setWorkflowVersionLoading] = useState(false);
  const [workflowSaving, setWorkflowSaving] = useState(false);
  const [auditEvents, setAuditEvents] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const [generatorGoal, setGeneratorGoal] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const [activeTab, setActiveTab] = useState('transcription');
  const [glossarySuggestions, setGlossarySuggestions] = useState([]);
  const [glossaryLoading, setGlossaryLoading] = useState(false);
  const [glossarySourceDocuments, setGlossarySourceDocuments] = useState(0);
  const {
    toast,
    showToast,
    clearToast,
    confirmDialog,
    confirm,
    closeConfirm,
    acceptConfirm,
  } = useUiFeedback();

  const contextTerms = parseContextTerms(contextBias);
  useEffect(() => {
    const queryTab = typeof router.query.tab === 'string' ? router.query.tab : '';
    if (!queryTab || !SETTINGS_TAB_IDS.includes(queryTab)) return;
    setActiveTab(queryTab);
  }, [router.query.tab]);

  function handleTabChange(nextTab) {
    setActiveTab(nextTab);
    router.replace(
      { pathname: '/settings', query: { tab: nextTab } },
      undefined,
      { shallow: true }
    );
  }

  function suggestTemplateNameFromGoal(goal) {
    const normalized = String(goal || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) return '';

    const firstPart = normalized.split(/[.!?]/)[0]?.trim() || normalized;
    return firstPart.slice(0, 80);
  }

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
      return;
    }
    if (status !== 'authenticated') return;

    const loadData = async () => {
      try {
        const [settingsData, templatesData, tasksData, categoriesData, workflowsData] = await Promise.all([
          getSettings(),
          getTemplates(),
          getTextTasks(),
          getTemplateCategories(),
          getWorkflows(),
        ]);

        setApiKeyConfigured(settingsData.apiKeyConfigured);
        setDefaultTemplate(normalizeDefaultTemplate(settingsData.defaultTemplate));
        setLanguage(settingsData.language || 'de');
        setContextBias(settingsData.contextBias || '');
        setCostLimit(settingsData.costLimit ?? '');
        setMemberMonthlyBudgetLimit(settingsData.memberMonthlyBudgetLimit ?? '');
        setPreferredModel(settingsData.preferredModel || 'mistral-large-latest');
        setDefaultTranslateLanguage(settingsData.defaultTranslateLanguage || 'en');
        setOcrModel(settingsData.ocrModel || 'mistral-ocr-latest');
        setTemplates(templatesData);
        setTextTasks(tasksData);
        setTemplateCategories(categoriesData);
        setCustomWorkflows((workflowsData || []).filter((entry) => entry.isCustom));
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

    getAuditLog(60)
      .then((payload) => setAuditEvents(payload?.events || []))
      .catch(() => {});
  }, [status, router]);

  async function handleSaveSettings(e) {
    if (e) e.preventDefault();
    setError('');
    setSaved(false);
    setIsSavingSettings(true);

    try {
      const payload = {
        defaultTemplate: normalizeDefaultTemplate(defaultTemplate),
        language,
        contextBias,
        costLimit: costLimit === '' ? null : parseFloat(costLimit),
        memberMonthlyBudgetLimit: memberMonthlyBudgetLimit === '' ? null : parseFloat(memberMonthlyBudgetLimit),
        preferredModel,
        defaultTranslateLanguage,
        ocrModel,
      };

      if (apiKey !== '') payload.mistralApiKey = apiKey;

      await updateSettings(payload);

      setSaved(true);
      if (apiKey) {
        setApiKeyConfigured(true);
        setApiKey('');
      }
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError('Einstellungen konnten nicht gespeichert werden.');
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function handleClearMistralApiKey() {
    if (!apiKeyConfigured && !apiKey.trim()) return;
    setIsClearingMistralKey(true);
    try {
      await updateSettings({ mistralApiKey: '' });
      setApiKey('');
      setApiKeyConfigured(false);
      showToast('Mistral API-Key wurde entfernt.', 'success');
    } catch {
      showToast('Mistral API-Key konnte nicht entfernt werden.', 'error');
    } finally {
      setIsClearingMistralKey(false);
    }
  }

  async function handleGenerateAI() {
    if (!generatorGoal.trim()) return;
    setIsGenerating(true);
    try {
      const { promptText } = await generateTemplatePrompt(generatorGoal);
      const suggestedName = suggestTemplateNameFromGoal(generatorGoal);
      setActiveEditor((prev) => {
        if (!prev) return prev;
        const currentName = String(prev.name || '').trim();
        const shouldSetSuggestedName = prev.id === 'new' && !currentName;
        return {
          ...prev,
          name: shouldSetSuggestedName ? suggestedName : prev.name,
          prompt_text: promptText,
        };
      });
      setGeneratorGoal('');
    } catch (err) {
      showToast('Fehler bei der KI-Generierung: ' + err.message, 'error');
    } finally {
      setIsGenerating(false);
    }
  }

  function handleAddContextTerm(term) {
    const normalizedTerm = String(term || '').trim();
    if (!normalizedTerm) return;
    if (contextTerms.some((entry) => entry.toLocaleLowerCase('de-DE') === normalizedTerm.toLocaleLowerCase('de-DE'))) {
      return;
    }
    setContextBias([...contextTerms, normalizedTerm].join(', '));
    setGlossarySuggestions((prev) =>
      prev.filter((entry) => entry.term.toLocaleLowerCase('de-DE') !== normalizedTerm.toLocaleLowerCase('de-DE'))
    );
  }

  function handleRemoveContextTerm(term) {
    const key = String(term || '').toLocaleLowerCase('de-DE');
    const filtered = contextTerms.filter((entry) => entry.toLocaleLowerCase('de-DE') !== key);
    setContextBias(filtered.join(', '));
  }

  async function handleLoadGlossarySuggestions() {
    setGlossaryLoading(true);
    try {
      const payload = await getGlossarySuggestions(30);
      setGlossarySuggestions(payload.suggestions || []);
      setGlossarySourceDocuments(payload.sourceDocuments || 0);
    } catch {
      showToast('Auto-Glossar konnte nicht geladen werden.', 'error');
    } finally {
      setGlossaryLoading(false);
    }
  }

  // Template Handlers
  async function handleSaveTemplate() {
    if (!activeEditor) return;
    const normalizedName = String(activeEditor.name || '').trim();
    const normalizedPrompt = String(activeEditor.prompt_text || '').trim();

    if (!normalizedName) {
      showToast('Bitte einen Namen für die Vorlage eingeben.', 'error');
      return;
    }
    if (!normalizedPrompt) {
      showToast('Bitte zuerst einen Prompt für die Vorlage eingeben.', 'error');
      return;
    }

    setTemplateLoading(true);

    try {
      if (activeEditor.isDefault) {
        const existing = templates.find(t => t.name === activeEditor.id);
        if (existing) {
          const updated = await updateTemplate(existing.id, { 
            name: activeEditor.id, 
            prompt_text: normalizedPrompt,
            template_type: 'text',
            table_schema: null
          });
          setTemplates(templates.map(t => t.id === updated.id ? updated : t));
        } else {
          const created = await createTemplate({ 
            name: activeEditor.id, 
            prompt_text: normalizedPrompt,
            template_type: 'text',
            table_schema: null
          });
          setTemplates([...templates, created]);
        }
      } else if (activeEditor.id === 'new') {
        const created = await createTemplate({ 
          name: normalizedName, 
          prompt_text: normalizedPrompt,
          template_type: 'text',
          table_schema: null
        });
        setTemplates([...templates, created]);
      } else {
        const updated = await updateTemplate(activeEditor.id, { 
          name: normalizedName, 
          prompt_text: normalizedPrompt,
          template_type: 'text',
          table_schema: null
        });
        setTemplates(templates.map(t => t.id === updated.id ? updated : t));
      }
      setActiveEditor(null);
      showToast('Vorlage gespeichert.', 'success');
    } catch (err) {
      showToast('Fehler beim Speichern der Vorlage.', 'error');
    } finally {
      setTemplateLoading(false);
    }
  }

  // Table Template Handlers
  const openTableTemplateEditor = (template = null) => {
    if (template) {
      setTableSchema(template.table_schema || {
        tableName: template.name,
        description: '',
        columns: [],
        rows: [],
        calculations: []
      });
      setTableTemplateEditor({
        id: template.id,
        name: template.name,
        isEditing: true
      });
    } else {
      setTableSchema({
        tableName: '',
        description: '',
        columns: [],
        rows: [],
        calculations: []
      });
      setTableTemplateEditor({
        id: 'new',
        name: '',
        isEditing: false
      });
    }
  };

  const handleSaveTableTemplate = async () => {
    if (!tableTemplateEditor) return;
    
    const normalizedName = String(tableTemplateEditor.name || '').trim();
    if (!normalizedName) {
      showToast('Bitte einen Namen für die Vorlage eingeben.', 'error');
      return;
    }
    
    const validation = validateTableSchema(tableSchema);
    if (!validation.isValid) {
      showToast(`Bitte korrigieren Sie die Fehler im Schema: ${validation.errors.join(' | ')}`, 'error');
      return;
    }
    
    setTemplateLoading(true);
    
    try {
      const extractionPrompt = buildTableExtractionPrompt(tableSchema, language);
      
      const templateData = {
        name: normalizedName,
        prompt_text: extractionPrompt,
        template_type: 'table',
        table_schema: tableSchema
      };
      
      if (tableTemplateEditor.id === 'new') {
        const created = await createTemplate(templateData);
        setTemplates([...templates, created]);
      } else {
        const updated = await updateTemplate(tableTemplateEditor.id, templateData);
        setTemplates(templates.map(t => t.id === updated.id ? updated : t));
      }
      
      setTableTemplateEditor(null);
      setTableSchema(null);
      showToast('Tabellen-Vorlage gespeichert.', 'success');
    } catch (err) {
      console.error('Fehler beim Speichern:', err);
      showToast('Fehler beim Speichern der Tabellen-Vorlage.', 'error');
    } finally {
      setTemplateLoading(false);
    }
  };

  async function handleDelete(id) {
    const approved = await confirm({
      title: 'Vorlage löschen',
      message: 'Vorlage löschen?',
      confirmLabel: 'Löschen',
      danger: true,
    });
    if (!approved) return;
    try {
      await deleteTemplate(id);
      setTemplates(templates.filter(t => t.id !== id));
      showToast('Vorlage gelöscht.', 'success');
    } catch {
      showToast('Löschen fehlgeschlagen.', 'error');
    }
  }

  // Category Handlers
  async function handleCreateCategory(e) {
    if (e) e.preventDefault();
    if (!newCategoryName.trim()) return;
    try {
      const category = await createTemplateCategory({ name: newCategoryName.trim() });
      setTemplateCategories(prev => [...prev, category]);
      setNewCategoryName('');
      showToast('Kategorie erstellt.', 'success');
    } catch {
      showToast('Kategorie konnte nicht erstellt werden', 'error');
    }
  }

  async function handleUpdateCategory(id, name) {
    if (!name.trim()) return;
    try {
      const updated = await updateTemplateCategory(id, { name: name.trim() });
      setTemplateCategories(prev => prev.map(c => c.id === id ? updated : c));
      setEditingCategoryId(null);
      showToast('Kategorie aktualisiert.', 'success');
    } catch {
      showToast('Kategorie konnte nicht aktualisiert werden', 'error');
    }
  }

  async function handleDeleteCategory(id) {
    const approved = await confirm({
      title: 'Kategorie löschen',
      message: 'Kategorie löschen? Vorlagen in dieser Kategorie werden nicht gelöscht.',
      confirmLabel: 'Kategorie löschen',
      danger: true,
    });
    if (!approved) return;
    try {
      await deleteTemplateCategory(id);
      setTemplateCategories(prev => prev.filter(c => c.id !== id));
      setTemplates(prev => prev.map(t => t.category_id === id ? { ...t, category_id: null } : t));
      showToast('Kategorie gelöscht.', 'success');
    } catch {
      showToast('Löschen fehlgeschlagen.', 'error');
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
      showToast('Aufgabe gespeichert.', 'success');
    } catch (err) {
      showToast('Fehler beim Speichern der Aufgabe.', 'error');
    } finally {
      setTemplateLoading(false);
    }
  }

  async function handleDeleteTask(id) {
    const approved = await confirm({
      title: 'Aufgabe löschen',
      message: 'Aufgabe wirklich löschen?',
      confirmLabel: 'Aufgabe löschen',
      danger: true,
    });
    if (!approved) return;
    try {
      await deleteTextTask(id);
      setTextTasks(textTasks.filter(t => t.id !== id));
      showToast('Aufgabe gelöscht.', 'success');
    } catch {
      showToast('Löschen fehlgeschlagen.', 'error');
    }
  }

  async function handleToggleTaskFavorite(task) {
    try {
      const updated = await updateTextTask(task.id, { is_favorite: !task.is_favorite });
      setTextTasks(textTasks.map(t => t.id === updated.id ? updated : t));
    } catch {
      showToast('Favoriten-Status konnte nicht geändert werden.', 'error');
    }
  }

  function openWorkflowEditor(workflow = null) {
    if (!workflow) {
      setActiveWorkflowEditor({
        workflowId: null,
        name: '',
        description: '',
        note: '',
        steps: [
          { key: 'step_1', title: 'Schritt 1', instruction: '' },
          { key: 'step_2', title: 'Schritt 2', instruction: '' },
        ],
      });
      setWorkflowVersions([]);
      return;
    }

    setActiveWorkflowEditor({
      workflowId: workflow.id,
      name: workflow.name || '',
      description: workflow.description || '',
      note: '',
      steps: Array.isArray(workflow.steps) && workflow.steps.length > 0
        ? workflow.steps.map((step, idx) => ({
          key: step.key || `step_${idx + 1}`,
          title: step.title || step.label || `Schritt ${idx + 1}`,
          instruction: step.instruction || '',
        }))
        : [{ key: 'step_1', title: 'Schritt 1', instruction: '' }],
    });
    setWorkflowVersions([]);
  }

  function updateWorkflowStep(index, patch) {
    setActiveWorkflowEditor((prev) => {
      if (!prev) return prev;
      const steps = prev.steps.map((step, idx) => idx === index ? { ...step, ...patch } : step);
      return { ...prev, steps };
    });
  }

  function addWorkflowStep() {
    setActiveWorkflowEditor((prev) => {
      if (!prev) return prev;
      const nextIndex = prev.steps.length + 1;
      return {
        ...prev,
        steps: [...prev.steps, { key: `step_${nextIndex}`, title: `Schritt ${nextIndex}`, instruction: '' }],
      };
    });
  }

  function removeWorkflowStep(index) {
    setActiveWorkflowEditor((prev) => {
      if (!prev || prev.steps.length <= 1) return prev;
      return {
        ...prev,
        steps: prev.steps.filter((_, idx) => idx !== index),
      };
    });
  }

  async function handleSaveWorkflow() {
    if (!activeWorkflowEditor) return;
    setWorkflowSaving(true);
    try {
      const saved = await saveWorkflow({
        workflowId: activeWorkflowEditor.workflowId,
        name: activeWorkflowEditor.name,
        description: activeWorkflowEditor.description,
        steps: activeWorkflowEditor.steps,
        note: activeWorkflowEditor.note,
      });
      const all = await getWorkflows();
      setCustomWorkflows((all || []).filter((entry) => entry.isCustom));
      setActiveWorkflowEditor((prev) => prev ? { ...prev, workflowId: saved?.id || prev.workflowId, note: '' } : prev);
      showToast('Workflow gespeichert.', 'success');
    } catch (err) {
      showToast(err.message || 'Workflow konnte nicht gespeichert werden.', 'error');
    } finally {
      setWorkflowSaving(false);
    }
  }

  async function handleLoadWorkflowVersions(workflowId) {
    setWorkflowVersionLoading(true);
    try {
      const payload = await getWorkflowVersions(workflowId);
      setWorkflowVersions(payload?.versions || []);
    } catch (err) {
      showToast(err.message || 'Workflow-Versionen konnten nicht geladen werden.', 'error');
    } finally {
      setWorkflowVersionLoading(false);
    }
  }

  async function handleRollbackWorkflow(workflowId, version) {
    if (!workflowId || !version) return;
    const approved = await confirm({
      title: 'Workflow zurücksetzen',
      message: `Workflow auf Version ${version} zurücksetzen?`,
      confirmLabel: 'Zurücksetzen',
      danger: true,
    });
    if (!approved) return;
    try {
      await rollbackWorkflowVersion(workflowId, version);
      const all = await getWorkflows();
      setCustomWorkflows((all || []).filter((entry) => entry.isCustom));
      if (activeWorkflowEditor?.workflowId === workflowId) {
        const refreshed = (all || []).find((entry) => entry.id === workflowId);
        if (refreshed) {
          openWorkflowEditor(refreshed);
        }
      }
      await handleLoadWorkflowVersions(workflowId);
      showToast(`Workflow auf Version ${version} zurückgesetzt.`, 'success');
    } catch (err) {
      showToast(err.message || 'Rollback fehlgeschlagen.', 'error');
    }
  }

  async function handleDeleteWorkflow(workflowId) {
    const approved = await confirm({
      title: 'Workflow deaktivieren',
      message: 'Workflow wirklich deaktivieren?',
      confirmLabel: 'Deaktivieren',
      danger: true,
    });
    if (!approved) return;
    try {
      await deleteWorkflow(workflowId);
      setCustomWorkflows((prev) => prev.filter((entry) => entry.id !== workflowId));
      if (activeWorkflowEditor?.workflowId === workflowId) {
        setActiveWorkflowEditor(null);
      }
      showToast('Workflow deaktiviert.', 'success');
    } catch (err) {
      showToast(err.message || 'Workflow konnte nicht deaktiviert werden.', 'error');
    }
  }

  async function handleReloadAudit() {
    setAuditLoading(true);
    try {
      const payload = await getAuditLog(80);
      setAuditEvents(payload?.events || []);
    } catch {
      showToast('Audit-Log konnte nicht geladen werden.', 'error');
    } finally {
      setAuditLoading(false);
    }
  }

  const openDefaultEditor = (key) => {
    const override = templates.find(t => t.name === key);
    const defaultOption = DEFAULT_TEXT_TEMPLATE_OPTIONS.find((entry) => entry.key === key);
    setActiveEditor({
      id: key,
      name: defaultOption?.label || key,
      prompt_text: override ? override.prompt_text : getPrompt(key, language),
      isDefault: true
    });
  };

  if (status === 'loading' || loading) return <LoadingSpinner />;

  const TABS = [
    { id: 'transcription', label: 'Transkription', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg> },
    { id: 'analysis', label: 'Verarbeitungstemplates', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg> },
    { id: 'tasks', label: 'Text-Assistent', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg> },
    { id: 'ocr-translate', label: 'OCR & Übersetzung', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" /></svg> },
    { id: 'account', label: 'Konto & API', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg> },
  ];

  // Separate table templates from text templates
  const textTemplates = templates.filter(t => !t.template_type || t.template_type === 'text');
  const tableTemplates = templates.filter(t => t.template_type === 'table');
  const activeTabMeta = TABS.find((tab) => tab.id === activeTab);

  return (
    <>
      <Head><title>Einstellungen - GhostTyper</title></Head>

      <div className={(activeEditor || tableTemplateEditor) ? 'hidden' : 'max-w-5xl mx-auto animate-fade-in pb-20'}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <h1 className="text-2xl font-bold text-text-primary">Einstellungen</h1>
          {saved && <p className="text-accent-green text-xs animate-pulse bg-accent-green/10 px-3 py-1 rounded-full border border-accent-green/20">Einstellungen gespeichert!</p>}
        </div>

        {/* Tab Navigation */}
        <div
          className="flex items-center gap-1 bg-white/5 p-1 rounded-2xl mb-8 overflow-x-auto no-scrollbar border border-white/[0.06]"
          role="tablist"
          aria-label="Einstellungen-Bereiche"
        >
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              role="tab"
              id={`settings-tab-${tab.id}`}
              aria-selected={activeTab === tab.id}
              aria-controls={`settings-panel-${tab.id}`}
              tabIndex={activeTab === tab.id ? 0 : -1}
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

        <div
          className="space-y-8"
          role="tabpanel"
          id={`settings-panel-${activeTab}`}
          aria-labelledby={`settings-tab-${activeTab}`}
          aria-label={activeTabMeta?.label || 'Einstellungen'}
        >
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

                    <div className="mt-4 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[10px] font-bold text-text-secondary uppercase tracking-wider">Aktive Begriffe</p>
                        <button
                          type="button"
                          onClick={handleLoadGlossarySuggestions}
                          disabled={glossaryLoading}
                          className="text-[10px] text-accent-orange hover:text-accent-cyan disabled:opacity-40"
                        >
                          {glossaryLoading ? 'Lädt...' : 'Auto-Glossar laden'}
                        </button>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {contextTerms.length === 0 && (
                          <span className="text-[11px] text-text-secondary/70">Noch keine Begriffe gespeichert.</span>
                        )}
                        {contextTerms.map((term) => (
                          <button
                            key={term}
                            type="button"
                            onClick={() => handleRemoveContextTerm(term)}
                            className="px-2.5 py-1 rounded-full text-[11px] border border-white/10 bg-white/5 text-text-primary hover:border-accent-red/40 hover:text-accent-red transition-colors"
                            title="Begriff entfernen"
                          >
                            {term}
                          </button>
                        ))}
                      </div>

                      {glossarySuggestions.length > 0 && (
                        <div className="pt-2">
                          <p className="text-[10px] text-text-secondary mb-2">
                            Vorschläge aus {glossarySourceDocuments} Dokumenten
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {glossarySuggestions.map((entry) => (
                              <button
                                key={entry.term}
                                type="button"
                                onClick={() => handleAddContextTerm(entry.term)}
                                className="px-2.5 py-1 rounded-full text-[11px] border border-accent-orange/30 bg-accent-orange/10 text-accent-orange hover:bg-accent-orange/20 transition-colors"
                                title={`${entry.count} Treffer`}
                              >
                                + {entry.term}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
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
                <button
                  onClick={handleSaveSettings}
                  disabled={isSavingSettings}
                  className="w-full gradient-accent text-white py-3.5 rounded-2xl font-semibold shadow-lg shadow-accent-orange/20 transition-all hover:scale-[1.01] disabled:opacity-40"
                >
                  {isSavingSettings ? 'Speichert...' : 'Speichern'}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'analysis' && (
            <div className="space-y-8 animate-fade-in">
              {/* Categories Section */}
              <div className="bg-dark-card border border-white/[0.06] rounded-2xl p-6 shadow-xl">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-widest">Kategorien</h2>
                    <p className="text-xs text-text-secondary mt-1">Organisieren Sie Ihre Vorlagen in Kategorien</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {templateCategories.map(cat => (
                    <div key={cat.id} className="group flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-3 py-1.5">
                      {editingCategoryId === cat.id ? (
                        <input
                          autoFocus
                          type="text"
                          value={editingCategoryName}
                          onChange={e => setEditingCategoryName(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleUpdateCategory(cat.id, editingCategoryName)}
                          onBlur={() => setEditingCategoryId(null)}
                          className="bg-transparent border-none text-xs text-text-primary outline-none w-24"
                        />
                      ) : (
                        <>
                          <span className="w-2 h-2 rounded-full bg-accent-orange" />
                          <span className="text-xs text-text-primary">{cat.name}</span>
                        </>
                      )}
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => { setEditingCategoryId(cat.id); setEditingCategoryName(cat.name); }}
                          className="text-text-secondary hover:text-white"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                        </button>
                        <button
                          onClick={() => handleDeleteCategory(cat.id)}
                          className="text-text-secondary hover:text-accent-red"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    </div>
                  ))}
                  <form onSubmit={handleCreateCategory} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newCategoryName}
                      onChange={e => setNewCategoryName(e.target.value)}
                      placeholder="Neue Kategorie..."
                      className="bg-dark-input border border-white/10 rounded-full px-3 py-1.5 text-xs text-text-primary outline-none w-32"
                    />
                    <button type="submit" disabled={!newCategoryName.trim()} className="text-accent-orange hover:text-accent-orange/80 disabled:opacity-30">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                    </button>
                  </form>
                </div>
              </div>

              {/* Text Templates Section */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 bg-dark-card border border-white/[0.06] rounded-2xl p-6 shadow-xl">
                  <div className="flex items-center justify-between mb-8">
                    <div>
                      <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-widest">Text-Verarbeitung</h2>
                      <p className="text-xs text-text-secondary mt-1">Standard- und eigene Textvorlagen</p>
                    </div>
                    <button
                      onClick={() => setActiveEditor({ id: 'new', name: '', prompt_text: '', isDefault: false })}
                      className="gradient-accent text-white px-5 py-2 rounded-xl text-xs font-bold shadow-lg"
                    >
                      + Neue Text-Vorlage
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Defaults */}
                    {DEFAULT_TEXT_TEMPLATE_OPTIONS.map(({ key, label }) => (
                      <div key={key} className="flex items-center justify-between p-4 bg-white/5 rounded-xl border border-white/5 group hover:border-accent-orange/30 transition-all">
                        <span className="text-sm font-medium text-text-primary capitalize">
                          {label}
                        </span>
                        <button onClick={() => openDefaultEditor(key)} className="text-[10px] font-bold text-accent-orange uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity">Edit</button>
                      </div>
                    ))}
                    {/* Custom Text Templates */}
                    {textTemplates.filter(t => !DEFAULT_TEXT_TEMPLATE_OPTIONS.some((entry) => entry.key === t.name)).map(t => (
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
                      <option value="mistral-small-latest">Kostengünstig / Schnell</option>
                      <option value="mistral-medium-latest">Ausgewogen</option>
                      <option value="mistral-large-latest">Qualität</option>
                    </select>
                    <p className="mt-3 text-[10px] text-text-secondary leading-relaxed italic">
                      Dieses Modell wird standardmäßig für KI-Analyse und Textaufgaben verwendet.
                    </p>
                  </div>
                  <button
                    onClick={handleSaveSettings}
                    disabled={isSavingSettings}
                    className="w-full gradient-accent text-white py-3.5 rounded-2xl font-semibold shadow-lg shadow-accent-orange/20 transition-all hover:scale-[1.01] disabled:opacity-40"
                  >
                    {isSavingSettings ? 'Speichert...' : 'Speichern'}
                  </button>
                </div>
              </div>

              {/* Table Templates Section */}
              <div className="bg-dark-card border border-white/[0.06] rounded-2xl p-6 shadow-xl">
                <div className="flex items-center justify-between mb-8">
                  <div>
                    <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-widest">Tabellen-Verarbeitung</h2>
                    <p className="text-xs text-text-secondary mt-1">
                      Extrahieren Sie strukturierte Daten als Tabelle (z.B. Rechnungen, Listen)
                    </p>
                  </div>
                  <button
                    onClick={() => openTableTemplateEditor()}
                    className="gradient-accent text-white px-5 py-2 rounded-xl text-xs font-bold shadow-lg"
                  >
                    + Neue Tabellen-Vorlage
                  </button>
                </div>

                {tableTemplates.length === 0 ? (
                  <div className="text-center py-8 bg-white/5 rounded-xl border border-dashed border-white/10">
                    <p className="text-text-secondary text-sm">
                      Noch keine Tabellen-Vorlagen erstellt.
                    </p>
                    <p className="text-text-secondary/60 text-xs mt-1">
                      Ideal für Rechnungen, Inventare, Zeiterfassung und mehr.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {tableTemplates.map(t => (
                      <div key={t.id} className="flex items-center justify-between p-4 bg-white/5 rounded-xl border border-white/5 group hover:border-accent-orange/30 transition-all">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-accent-orange/20 flex items-center justify-center">
                            <svg className="w-4 h-4 text-accent-orange" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7-4h14M4 6h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2z" />
                            </svg>
                          </div>
                          <div>
                            <span className="text-sm font-medium text-text-primary block">{t.name}</span>
                            <span className="text-[10px] text-text-secondary">
                              {t.table_schema?.columns?.length || 0} Spalten
                              {t.table_schema?.rows?.length > 0 && ` • ${t.table_schema.rows.length} Zeilen`}
                              {t.table_schema?.calculations?.length > 0 && ` • ${t.table_schema.calculations.length} Berechnungen`}
                            </span>
                          </div>
                        </div>
                        <div className="flex gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => openTableTemplateEditor(t)} className="text-[10px] font-bold text-accent-orange uppercase">Edit</button>
                          <button onClick={() => handleDelete(t.id)} className="text-[10px] font-bold text-text-secondary uppercase hover:text-accent-red">Löschen</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'tasks' && (
            <div className="space-y-8 animate-fade-in">
              <div className="bg-dark-card border border-white/[0.06] rounded-2xl p-6 shadow-xl">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-widest">Workflow-Automationen (Text)</h2>
                    <p className="text-xs text-text-secondary mt-1">Mehrstufige KI-Textketten mit Versionierung und Rollback.</p>
                  </div>
                  <button
                    onClick={() => openWorkflowEditor()}
                    className="gradient-accent text-white px-5 py-2 rounded-xl text-xs font-bold shadow-lg"
                  >
                    + Neuer Workflow
                  </button>
                </div>

                {customWorkflows.length === 0 ? (
                  <div className="text-xs text-text-secondary bg-white/5 border border-dashed border-white/10 rounded-xl p-4">
                    Noch keine eigenen Workflows angelegt.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {customWorkflows.map((workflow) => (
                      <div key={workflow.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm text-text-primary font-semibold">{workflow.name}</p>
                            <p className="text-[11px] text-text-secondary mt-1">{workflow.description || 'Keine Beschreibung'}</p>
                            <p className="text-[10px] text-text-secondary mt-2">Version {workflow.version} • {workflow.estimatedSteps} Schritte</p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                openWorkflowEditor(workflow);
                                handleLoadWorkflowVersions(workflow.id);
                              }}
                              className="text-[10px] font-bold text-accent-orange uppercase"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteWorkflow(workflow.id)}
                              className="text-[10px] font-bold text-text-secondary uppercase hover:text-accent-red"
                            >
                              Deaktivieren
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {activeWorkflowEditor && (
                <div className="bg-dark-card border border-accent-orange/30 rounded-2xl p-6 shadow-xl">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-sm font-semibold text-text-primary">
                      {activeWorkflowEditor.workflowId ? 'Workflow bearbeiten' : 'Neuer Workflow'}
                    </h3>
                    <div className="flex gap-2">
                      {activeWorkflowEditor.workflowId && (
                        <button
                          onClick={() => handleLoadWorkflowVersions(activeWorkflowEditor.workflowId)}
                          disabled={workflowVersionLoading}
                          className="px-3 py-1.5 text-[11px] rounded-lg border border-white/15 text-text-secondary hover:text-text-primary disabled:opacity-40"
                        >
                          {workflowVersionLoading ? 'Lädt...' : 'Versionen laden'}
                        </button>
                      )}
                      <button
                        onClick={() => setActiveWorkflowEditor(null)}
                        className="px-3 py-1.5 text-[11px] rounded-lg border border-white/15 text-text-secondary hover:text-text-primary"
                      >
                        Schließen
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className="block text-[10px] font-bold text-text-secondary uppercase tracking-widest mb-2">Name</label>
                      <input
                        value={activeWorkflowEditor.name}
                        onChange={(e) => setActiveWorkflowEditor((prev) => prev ? { ...prev, name: e.target.value } : prev)}
                        className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-text-primary outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-text-secondary uppercase tracking-widest mb-2">Versions-Notiz</label>
                      <input
                        value={activeWorkflowEditor.note}
                        onChange={(e) => setActiveWorkflowEditor((prev) => prev ? { ...prev, note: e.target.value } : prev)}
                        placeholder="z. B. Prompt für Schritt 2 verbessert"
                        className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-text-primary outline-none"
                      />
                    </div>
                  </div>

                  <div className="mb-5">
                    <label className="block text-[10px] font-bold text-text-secondary uppercase tracking-widest mb-2">Beschreibung</label>
                    <textarea
                      value={activeWorkflowEditor.description}
                      onChange={(e) => setActiveWorkflowEditor((prev) => prev ? { ...prev, description: e.target.value } : prev)}
                      rows={2}
                      className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-text-primary outline-none resize-none"
                    />
                  </div>

                  <div className="space-y-3">
                    {activeWorkflowEditor.steps.map((step, index) => (
                      <div key={`${step.key}-${index}`} className="border border-white/10 rounded-xl p-3 bg-white/[0.02]">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
                          <input
                            value={step.key}
                            onChange={(e) => updateWorkflowStep(index, { key: e.target.value })}
                            placeholder="step_key"
                            className="bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2 text-xs text-text-primary outline-none"
                          />
                          <input
                            value={step.title}
                            onChange={(e) => updateWorkflowStep(index, { title: e.target.value })}
                            placeholder="Schritt-Titel"
                            className="md:col-span-2 bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2 text-xs text-text-primary outline-none"
                          />
                        </div>
                        <textarea
                          value={step.instruction}
                          onChange={(e) => updateWorkflowStep(index, { instruction: e.target.value })}
                          rows={3}
                          placeholder="Anweisung für diesen Schritt"
                          className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2 text-xs text-text-primary outline-none resize-y"
                        />
                        <div className="mt-2 flex justify-end">
                          <button
                            onClick={() => removeWorkflowStep(index)}
                            className="text-[10px] text-text-secondary hover:text-accent-red"
                          >
                            Schritt entfernen
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      onClick={addWorkflowStep}
                      className="px-3 py-1.5 rounded-lg text-[11px] border border-white/15 text-text-secondary hover:text-text-primary"
                    >
                      + Schritt
                    </button>
                    <button
                      onClick={handleSaveWorkflow}
                      disabled={workflowSaving}
                      className="px-4 py-1.5 rounded-lg text-[11px] font-semibold bg-accent-orange/20 border border-accent-orange/30 text-accent-orange disabled:opacity-40"
                    >
                      {workflowSaving ? 'Speichert...' : 'Workflow speichern'}
                    </button>
                  </div>

                  {workflowVersions.length > 0 && (
                    <div className="mt-5 border-t border-white/10 pt-4">
                      <p className="text-[10px] font-bold text-text-secondary uppercase tracking-widest mb-2">Versionen</p>
                      <div className="space-y-2">
                        {workflowVersions.map((version) => (
                          <div key={version.version} className="flex items-center justify-between text-xs border border-white/10 rounded-lg px-3 py-2 bg-white/[0.02]">
                            <div>
                              <span className="text-text-primary">Version {version.version}</span>
                              <span className="text-text-secondary ml-2">{version.note || 'ohne Notiz'}</span>
                            </div>
                            {version.isActive ? (
                              <span className="text-accent-green text-[10px]">Aktiv</span>
                            ) : (
                              <button
                                onClick={() => handleRollbackWorkflow(activeWorkflowEditor.workflowId, version.version)}
                                className="text-[10px] text-accent-orange hover:text-accent-cyan"
                              >
                                Rollback
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="bg-dark-card border border-white/[0.06] rounded-2xl p-8 shadow-xl">
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
                            <svg className="w-4 h-4" fill={task.is_favorite ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.382-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
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
                  <button
                    onClick={handleSaveSettings}
                    disabled={isSavingSettings}
                    className="w-full gradient-accent text-white py-3.5 rounded-2xl font-semibold shadow-lg shadow-accent-orange/20 transition-all hover:scale-[1.01] disabled:opacity-40"
                  >
                    {isSavingSettings ? 'Speichert...' : 'Speichern'}
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
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <span className={`text-[11px] ${apiKeyConfigured ? 'text-accent-green' : 'text-text-secondary'}`}>
                          {apiKeyConfigured ? 'API-Key hinterlegt' : 'Kein API-Key hinterlegt'}
                        </span>
                        <button
                          type="button"
                          onClick={handleClearMistralApiKey}
                          disabled={isClearingMistralKey || isSavingSettings || !apiKeyConfigured}
                          className="text-[11px] text-accent-red hover:text-red-300 disabled:opacity-40"
                        >
                          {isClearingMistralKey ? 'Entferne...' : 'Key entfernen'}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1.5">Monatliches Kostenlimit (€)</label>
                      <input type="number" value={costLimit} onChange={e => setCostLimit(e.target.value)} placeholder="Kein Limit" className="w-full bg-dark-input border border-white/[0.1] rounded-xl px-4 py-2.5 text-sm text-text-primary outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1.5">Mitglieder-Budgetlimit / Monat (€)</label>
                      <input
                        type="number"
                        value={memberMonthlyBudgetLimit}
                        onChange={e => setMemberMonthlyBudgetLimit(e.target.value)}
                        placeholder="Optional, überschreibt bei Bedarf das Konto-Limit"
                        className="w-full bg-dark-input border border-white/[0.1] rounded-xl px-4 py-2.5 text-sm text-text-primary outline-none"
                      />
                    </div>
                  </div>
                </div>
                <button
                  onClick={handleSaveSettings}
                  disabled={isSavingSettings || isClearingMistralKey}
                  className="w-full gradient-accent text-white py-3.5 rounded-2xl font-semibold shadow-lg shadow-accent-orange/20 transition-all hover:scale-[1.01] disabled:opacity-40"
                >
                  {isSavingSettings ? 'Speichert...' : 'Speichern'}
                </button>
              </div>

              <div className="space-y-6">
                {usage && (
                  <div className="bg-dark-card border border-white/[0.06] rounded-2xl p-6 shadow-xl relative overflow-hidden">
                    <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-widest mb-6">Verbrauch aktuell</h2>
                    <div className="grid grid-cols-2 gap-4 mb-6">
                      <div className="bg-white/5 rounded-xl p-4 border border-white/5">
                        <p className="text-xs text-text-secondary uppercase font-bold tracking-wider mb-1">Kosten</p>
                        <p className="text-2xl font-bold text-accent-orange">{usage.totalCost?.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</p>
                      </div>
                      <div className="bg-white/5 rounded-xl p-4 border border-white/5">
                        <p className="text-xs text-text-secondary uppercase font-bold tracking-wider mb-1">Anfragen</p>
                        <p className="text-2xl font-bold text-text-primary">{usage.totalRequests}</p>
                      </div>
                    </div>
                    <div className="space-y-2 border-t border-white/5 pt-4">
                      <h3 className="text-xs font-bold text-text-secondary uppercase mb-2 opacity-70">Preisliste (pro 1M Tokens)</h3>
                      {PRICE_LIST.map(p => (
                        <div key={p.model} className="flex items-center justify-between text-xs">
                          <span className="text-text-primary">{p.model}</span>
                          <span className="text-text-secondary">In: {p.input} | Out: {p.output}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="bg-dark-card border border-white/[0.06] rounded-2xl p-6 shadow-xl">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-widest">Audit-Log</h2>
                    <button
                      onClick={handleReloadAudit}
                      disabled={auditLoading}
                      className="text-[11px] text-accent-orange hover:text-accent-cyan disabled:opacity-40"
                    >
                      {auditLoading ? 'Lädt...' : 'Neu laden'}
                    </button>
                  </div>
                  <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                    {auditEvents.length === 0 && (
                      <p className="text-xs text-text-secondary">Noch keine kritischen Aktionen protokolliert.</p>
                    )}
                    {auditEvents.map((entry) => (
                      <div key={entry.id} className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
                        <p className="text-xs text-text-primary">{entry.action}</p>
                        <p className="text-[10px] text-text-secondary mt-1">
                          {new Date(entry.created_at).toLocaleString('de-DE')} {entry.target_type ? `• ${entry.target_type}` : ''}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Text Task Editor Overlay */}
      {activeTaskEditor && (
        <div className="fixed inset-0 z-[110] bg-dark-bg flex flex-col animate-fade-in">
          <header className="h-16 border-b border-white/[0.06] bg-dark-card flex items-center justify-between px-6">
            <div className="flex items-center gap-4">
              <button onClick={() => setActiveTaskEditor(null)} className="p-2 text-text-secondary hover:text-text-primary transition-colors" aria-label="Aufgaben-Editor schließen"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg></button>
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
                aria-label={activeTaskEditor.is_favorite ? 'Als Favorit markieren deaktivieren' : 'Als Favorit markieren'}
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

      {/* Text Template Editor Overlay */}
      {activeEditor && (
        <div className="fixed inset-0 z-[110] bg-dark-bg flex flex-col animate-fade-in">
          <header className="h-16 border-b border-white/[0.06] bg-dark-card flex items-center justify-between px-6">
            <div className="flex items-center gap-4">
              <button onClick={() => setActiveEditor(null)} className="p-2 text-text-secondary hover:text-text-primary transition-colors" aria-label="Vorlagen-Editor schließen"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg></button>
              <input 
                type="text" 
                value={activeEditor.name} 
                onChange={e => setActiveEditor({...activeEditor, name: e.target.value})} 
                disabled={activeEditor.isDefault && DEFAULT_TEXT_TEMPLATE_OPTIONS.some((entry) => entry.key === activeEditor.id)} 
                className="bg-transparent border-none text-lg font-semibold text-text-primary outline-none focus:ring-0 w-full max-w-md" 
                placeholder="Name der Vorlage..."
              />
            </div>
            <div className="flex items-center gap-3">
              {activeEditor.isDefault && DEFAULT_TEXT_TEMPLATE_OPTIONS.some((entry) => entry.key === activeEditor.id) && <span className="text-[10px] bg-accent-orange/20 text-accent-orange px-2 py-1 rounded-full uppercase">Standard-Vorlage</span>}
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

      {/* Table Template Editor Overlay */}
      {tableTemplateEditor && (
        <div className="fixed inset-0 z-[110] bg-dark-bg flex flex-col animate-fade-in">
          <header className="h-16 border-b border-white/[0.06] bg-dark-card flex items-center justify-between px-6">
            <div className="flex items-center gap-4">
              <button onClick={() => { setTableTemplateEditor(null); setTableSchema(null); }} className="p-2 text-text-secondary hover:text-text-primary transition-colors" aria-label="Tabellen-Vorlagen-Editor schließen">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <input 
                type="text" 
                value={tableTemplateEditor.name} 
                onChange={e => setTableTemplateEditor({...tableTemplateEditor, name: e.target.value})} 
                className="bg-transparent border-none text-lg font-semibold text-text-primary outline-none focus:ring-0 w-full max-w-md" 
                placeholder="Name der Tabellen-Vorlage..."
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[10px] bg-accent-orange/20 text-accent-orange px-2 py-1 rounded-full uppercase">Tabellen-Vorlage</span>
              <button 
                onClick={handleSaveTableTemplate} 
                disabled={templateLoading} 
                className="gradient-accent text-white px-6 py-2 rounded-xl text-sm font-bold shadow-lg shadow-accent-orange/20"
              >
                {templateLoading ? 'Speichert...' : 'Vorlage speichern'}
              </button>
            </div>
          </header>
          <main className="flex-1 p-6 md:p-12 overflow-y-auto bg-black/20">
            <div className="max-w-4xl mx-auto">
              <TableSchemaBuilder 
                schema={tableSchema}
                onChange={setTableSchema}
              />
            </div>
          </main>
        </div>
      )}
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}
      <ConfirmDialog
        open={Boolean(confirmDialog)}
        title={confirmDialog?.title}
        message={confirmDialog?.message}
        confirmLabel={confirmDialog?.confirmLabel}
        cancelLabel={confirmDialog?.cancelLabel}
        danger={confirmDialog?.danger}
        onConfirm={acceptConfirm}
        onCancel={closeConfirm}
      />
    </>
  );
}
