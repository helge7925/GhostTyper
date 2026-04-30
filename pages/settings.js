import Head from 'next/head';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { useCallback, useState, useEffect } from 'react';
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
  getTemplateCategories,
  createTemplateCategory,
  updateTemplateCategory,
  deleteTemplateCategory,
  getGlossarySuggestions,
  getAuditLog,
} from '../lib/api';
import { normalizeDefaultTemplate } from '../lib/constants';
import { DEFAULT_PROMPTS, getPrompt } from '../lib/prompts';
import TableSchemaBuilder from '../components/TableSchemaBuilder';
import { validateTableSchema, buildTableExtractionPrompt } from '../lib/table-calculations';
import { createDefaultTableSchema, normalizeTableSchema } from '../lib/table-schema';
import { useUiFeedback } from '../lib/use-ui-feedback';

const PRICE_LIST = [
  { model: 'Mistral Large', input: '2,00 €', output: '6,00 €', note: 'Umfangreich' },
  { model: 'Mistral Medium', input: '0,75 €', output: '2,25 €', note: 'Ausgewogen' },
  { model: 'Mistral Small', input: '0,20 €', output: '0,60 €', note: 'Kompakt' },
  { model: 'Mistral Voxtral Mini', input: '0,01 €', output: '0,01 €', note: 'Transkription' },
];

const SETTINGS_TAB_IDS = ['transcription', 'text-templates', 'table-templates', 'ocr-translate', 'account'];
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

function tableSchemasEqual(a, b) {
  return JSON.stringify(normalizeTableSchema(a || createDefaultTableSchema())) === JSON.stringify(normalizeTableSchema(b || createDefaultTableSchema()));
}

function templateMatchesCategory(template, categoryId) {
  if (!categoryId || categoryId === 'all') return true;
  if (categoryId === 'uncategorized') return !template.category_id;
  return String(template.category_id || '') === String(categoryId);
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
  const [activeTextCategoryId, setActiveTextCategoryId] = useState('all');
  const [activeTableCategoryId, setActiveTableCategoryId] = useState('all');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingCategoryId, setEditingCategoryId] = useState(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');

  // Table Template states
  const [tableTemplateEditor, setTableTemplateEditor] = useState(null);
  const [tableSchema, setTableSchema] = useState(null);

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
  const canReadAudit = ['admin', 'auditor'].includes(session?.user?.role);

  const contextTerms = parseContextTerms(contextBias);
  useEffect(() => {
    const queryTab = typeof router.query.tab === 'string' ? router.query.tab : '';
    const normalizedTab = queryTab === 'analysis' ? 'text-templates' : queryTab;
    if (!normalizedTab || !SETTINGS_TAB_IDS.includes(normalizedTab)) return;
    setActiveTab(normalizedTab);
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
        const [settingsData, templatesData, categoriesData] = await Promise.all([
          getSettings(),
          getTemplates(),
          getTemplateCategories(),
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
        setTemplateCategories(categoriesData);
      } catch (err) {
        console.error('Failed to load settings or templates:', err);
      } finally {
        setLoading(false);
      }
    };

    loadData();

    fetch('/api/usage')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setUsage(data); })
      .catch(() => {});

    if (canReadAudit) {
      getAuditLog(60)
        .then((payload) => setAuditEvents(payload?.events || []))
        .catch(() => {});
    }
  }, [status, router, canReadAudit]);

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
            table_schema: null,
            category_id: activeEditor.category_id || null
          });
          setTemplates(templates.map(t => t.id === updated.id ? updated : t));
        } else {
          const created = await createTemplate({ 
            name: activeEditor.id, 
            prompt_text: normalizedPrompt,
            template_type: 'text',
            table_schema: null,
            category_id: activeEditor.category_id || null
          });
          setTemplates([...templates, created]);
        }
      } else if (activeEditor.id === 'new') {
        const created = await createTemplate({ 
          name: normalizedName, 
          prompt_text: normalizedPrompt,
          template_type: 'text',
          table_schema: null,
          category_id: activeEditor.category_id || null
        });
        setTemplates([...templates, created]);
      } else {
        const updated = await updateTemplate(activeEditor.id, { 
          name: normalizedName, 
          prompt_text: normalizedPrompt,
          template_type: 'text',
          table_schema: null,
          category_id: activeEditor.category_id || null
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
      setTableSchema(normalizeTableSchema(template.table_schema || {
        tableName: template.name,
        description: '',
        metadata: [],
        columns: [],
        rows: [],
        calculations: []
      }));
      setTableTemplateEditor({
        id: template.id,
        name: template.name,
        category_id: template.category_id || '',
        isEditing: true
      });
    } else {
      setTableSchema(createDefaultTableSchema());
      setTableTemplateEditor({
        id: 'new',
        name: '',
        category_id: activeTableCategoryId !== 'all' && activeTableCategoryId !== 'uncategorized' ? activeTableCategoryId : '',
        isEditing: false
      });
    }
  };

  const handleTableSchemaChange = useCallback((nextSchema) => {
    const normalizedSchema = normalizeTableSchema(nextSchema);
    const nextTableName = String(normalizedSchema.tableName || '').trim();
    setTableSchema((prevSchema) => (
      tableSchemasEqual(prevSchema, normalizedSchema) ? prevSchema : normalizedSchema
    ));
    if (nextTableName) {
      setTableTemplateEditor((prev) => {
        if (!prev) return prev;
        const currentName = String(prev.name || '').trim();
        if (currentName) return prev;
        return { ...prev, name: nextTableName };
      });
    }
  }, []);

  const handleTableTemplateNameChange = (nextName) => {
    const previousName = String(tableTemplateEditor?.name || '').trim();
    setTableTemplateEditor((prev) => (prev ? { ...prev, name: nextName } : prev));
    setTableSchema((prevSchema) => {
      const normalizedSchema = normalizeTableSchema(prevSchema || createDefaultTableSchema());
      const currentTableName = String(normalizedSchema.tableName || '').trim();
      if (currentTableName && currentTableName !== previousName) return prevSchema;
      const nextSchema = normalizeTableSchema({
        ...normalizedSchema,
        tableName: nextName,
      });
      return tableSchemasEqual(prevSchema, nextSchema) ? prevSchema : nextSchema;
    });
  };

  const handleSaveTableTemplate = async () => {
    if (!tableTemplateEditor) return;
    
    const schemaDraft = normalizeTableSchema(tableSchema || createDefaultTableSchema());
    const headerName = String(tableTemplateEditor.name || '').trim();
    const schemaTableName = String(schemaDraft.tableName || '').trim();
    const normalizedName = headerName || schemaTableName;
    if (!normalizedName) {
      showToast('Bitte einen Namen für die Vorlage eingeben.', 'error');
      return;
    }
    
    const cleanTableSchema = normalizeTableSchema({
      ...schemaDraft,
      tableName: schemaTableName || normalizedName,
      calculations: [],
    });
    const validation = validateTableSchema(cleanTableSchema);
    if (!validation.isValid) {
      showToast(`Bitte korrigieren Sie die Fehler im Schema: ${validation.errors.join(' | ')}`, 'error');
      return;
    }
    
    setTemplateLoading(true);
    
    try {
      const extractionPrompt = buildTableExtractionPrompt(cleanTableSchema, language);
      
      const templateData = {
        name: normalizedName,
        prompt_text: extractionPrompt,
        template_type: 'table',
        table_schema: cleanTableSchema,
        category_id: tableTemplateEditor.category_id || null
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
      setTemplateCategories(prev => prev.filter(c => String(c.id) !== String(id)));
      setTemplates(prev => prev.map(t => String(t.category_id || '') === String(id) ? { ...t, category_id: null } : t));
      if (String(activeTextCategoryId) === String(id)) setActiveTextCategoryId('all');
      if (String(activeTableCategoryId) === String(id)) setActiveTableCategoryId('all');
      showToast('Kategorie gelöscht.', 'success');
    } catch {
      showToast('Löschen fehlgeschlagen.', 'error');
    }
  }

  async function handleReloadAudit() {
    if (!canReadAudit) return;
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
      category_id: override?.category_id || '',
      isDefault: true
    });
  };

  if (status === 'loading' || loading) return <LoadingSpinner />;

  const TABS = [
    { id: 'transcription', label: 'Transkription', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg> },
    { id: 'text-templates', label: 'Text-Templates', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg> },
    { id: 'table-templates', label: 'Tabellen-Templates', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7h18M3 12h18M3 17h18M6 4v16M12 4v16M18 4v16" /></svg> },
    { id: 'ocr-translate', label: 'OCR & Übersetzung', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" /></svg> },
    { id: 'account', label: 'Konto & API', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg> },
  ];

  // Separate table templates from text templates
  const textTemplates = templates.filter(t => !t.template_type || t.template_type === 'text');
  const tableTemplates = templates.filter(t => t.template_type === 'table');
  const filteredTextTemplates = textTemplates.filter((template) => templateMatchesCategory(template, activeTextCategoryId));
  const filteredTableTemplates = tableTemplates.filter((template) => templateMatchesCategory(template, activeTableCategoryId));
  const activeTabMeta = TABS.find((tab) => tab.id === activeTab);
  const getCategoryName = (categoryId) => templateCategories.find((category) => String(category.id) === String(categoryId))?.name || 'Ohne Kategorie';

  const renderTemplateCategoryPanel = ({ activeCategoryId, onChange, templatesForCounts }) => {
    const uncategorizedCount = templatesForCounts.filter((template) => !template.category_id).length;
    return (
      <div className="bg-surface border border-subtle rounded-2xl p-6 shadow-xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-sm font-semibold text-secondary uppercase tracking-widest">Kategorien</h2>
            <p className="text-xs text-secondary mt-1">Organisieren und filtern Sie Ihre Vorlagen.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onChange('all')}
            className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
              activeCategoryId === 'all'
                ? 'bg-accent text-white border-accent'
                : 'bg-hover-subtle border-subtle text-primary hover:border-accent/40'
            }`}
          >
            Alle ({templatesForCounts.length})
          </button>
          <button
            type="button"
            onClick={() => onChange('uncategorized')}
            className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
              activeCategoryId === 'uncategorized'
                ? 'bg-accent text-white border-accent'
                : 'bg-hover-subtle border-subtle text-primary hover:border-accent/40'
            }`}
          >
            Ohne Kategorie ({uncategorizedCount})
          </button>
          {templateCategories.map((cat) => {
            const count = templatesForCounts.filter((template) => String(template.category_id || '') === String(cat.id)).length;
            return (
              <div key={cat.id} className="group flex items-center gap-2 bg-hover-subtle border border-subtle rounded-full px-3 py-1.5">
                {editingCategoryId === cat.id ? (
                  <input
                    autoFocus
                    type="text"
                    value={editingCategoryName}
                    onChange={e => setEditingCategoryName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleUpdateCategory(cat.id, editingCategoryName)}
                    onBlur={() => setEditingCategoryId(null)}
                    className="bg-transparent border-none text-xs text-primary outline-none w-24"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => onChange(String(cat.id))}
                    className={`flex items-center gap-2 text-xs transition-colors ${
                      String(activeCategoryId) === String(cat.id) ? 'text-accent' : 'text-primary hover:text-accent'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-accent" />
                    <span>{cat.name}</span>
                    <span className="text-secondary">({count})</span>
                  </button>
                )}
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => { setEditingCategoryId(cat.id); setEditingCategoryName(cat.name); }}
                    className="text-secondary hover:text-white"
                    aria-label={`Kategorie ${cat.name} bearbeiten`}
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteCategory(cat.id)}
                    className="text-secondary hover:text-danger"
                    aria-label={`Kategorie ${cat.name} löschen`}
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              </div>
            );
          })}
          <form onSubmit={handleCreateCategory} className="flex items-center gap-2">
            <input
              type="text"
              value={newCategoryName}
              onChange={e => setNewCategoryName(e.target.value)}
              placeholder="Neue Kategorie..."
              className="bg-surface-elevated border border-subtle rounded-full px-3 py-1.5 text-xs text-primary outline-none w-32"
            />
            <button type="submit" disabled={!newCategoryName.trim()} className="text-accent hover:text-accent/80 disabled:opacity-30" aria-label="Kategorie erstellen">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            </button>
          </form>
        </div>
      </div>
    );
  };

  return (
    <>
      <Head><title>Einstellungen - GhostTyper</title></Head>

      <div className={(activeEditor || tableTemplateEditor) ? 'hidden' : 'max-w-5xl mx-auto animate-fade-in pb-20'}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <h1 className="text-2xl font-bold text-primary">Einstellungen</h1>
          {saved && <p className="text-success text-xs animate-pulse bg-success/10 px-3 py-1 rounded-full border border-success/20">Einstellungen gespeichert!</p>}
        </div>

        {/* Tab Navigation */}
        <div
          className="flex items-center gap-1 bg-hover-subtle p-1 rounded-2xl mb-8 overflow-x-auto no-scrollbar border border-subtle"
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
                  ? 'bg-accent text-white shadow-lg shadow-accent/20' 
                  : 'text-secondary hover:text-primary hover:bg-hover-subtle'
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
              <div className="bg-surface border border-subtle rounded-2xl p-6 shadow-xl">
                <h2 className="text-sm font-semibold text-secondary uppercase tracking-widest mb-6">Transkription</h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-secondary mb-1.5">Standardsprache</label>
                    <select value={language} onChange={e => setLanguage(e.target.value)} className="w-full bg-surface-elevated border border-subtle rounded-xl px-4 py-2.5 text-sm text-primary outline-none">
                      <option value="de">Deutsch</option>
                      <option value="en">Englisch</option>
                      <option value="fr">Französisch</option>
                      <option value="es">Spanisch</option>
                      <option value="it">Italienisch</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-secondary mb-1.5">Kontext-Wörter (Context Bias)</label>
                    <textarea value={contextBias} onChange={e => setContextBias(e.target.value)} placeholder="Fachbegriffe, Namen, Abkürzungen..." rows={5} className="w-full bg-surface-elevated border border-subtle rounded-xl px-4 py-2.5 text-sm text-primary outline-none resize-none" />
                    <p className="mt-2 text-[10px] text-secondary italic">Hilft der KI, spezifische Begriffe korrekt zu transkribieren.</p>

                    <div className="mt-4 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[10px] font-bold text-secondary uppercase tracking-wider">Aktive Begriffe</p>
                        <button
                          type="button"
                          onClick={handleLoadGlossarySuggestions}
                          disabled={glossaryLoading}
                          className="text-[10px] text-accent hover:text-info disabled:opacity-40"
                        >
                          {glossaryLoading ? 'Lädt...' : 'Auto-Glossar laden'}
                        </button>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {contextTerms.length === 0 && (
                          <span className="text-[11px] text-secondary/70">Noch keine Begriffe gespeichert.</span>
                        )}
                        {contextTerms.map((term) => (
                          <button
                            key={term}
                            type="button"
                            onClick={() => handleRemoveContextTerm(term)}
                            className="px-2.5 py-1 rounded-full text-[11px] border border-subtle bg-hover-subtle text-primary hover:border-danger/40 hover:text-danger transition-colors"
                            title="Begriff entfernen"
                          >
                            {term}
                          </button>
                        ))}
                      </div>

                      {glossarySuggestions.length > 0 && (
                        <div className="pt-2">
                          <p className="text-[10px] text-secondary mb-2">
                            Vorschläge aus {glossarySourceDocuments} Dokumenten
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {glossarySuggestions.map((entry) => (
                              <button
                                key={entry.term}
                                type="button"
                                onClick={() => handleAddContextTerm(entry.term)}
                                className="px-2.5 py-1 rounded-full text-[11px] border border-accent/30 bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
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
                <div className="bg-surface border border-subtle rounded-2xl p-6 shadow-xl opacity-60">
                  <h3 className="text-sm font-semibold text-secondary uppercase tracking-widest mb-4">Modell-Info</h3>
                  <p className="text-xs text-secondary leading-relaxed">
                    Für die Transkription wird standardmäßig <strong>Mistral Voxtral Mini</strong> verwendet.
                  </p>
                </div>
                <button
                  onClick={handleSaveSettings}
                  disabled={isSavingSettings}
                  className="w-full gradient-accent text-white py-3.5 rounded-2xl font-semibold shadow-lg shadow-accent/20 transition-all hover:scale-[1.01] disabled:opacity-40"
                >
                  {isSavingSettings ? 'Speichert...' : 'Speichern'}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'text-templates' && (
            <div className="space-y-8 animate-fade-in">
              {renderTemplateCategoryPanel({
                activeCategoryId: activeTextCategoryId,
                onChange: setActiveTextCategoryId,
                templatesForCounts: textTemplates,
              })}

              {/* Text Templates Section */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 bg-surface border border-subtle rounded-2xl p-6 shadow-xl">
                  <div className="flex items-center justify-between mb-8">
                    <div>
                      <h2 className="text-sm font-semibold text-secondary uppercase tracking-widest">Text-Verarbeitung</h2>
                      <p className="text-xs text-secondary mt-1">Standard- und eigene Textvorlagen</p>
                    </div>
                    <button
                      onClick={() => setActiveEditor({
                        id: 'new',
                        name: '',
                        prompt_text: '',
                        category_id: activeTextCategoryId !== 'all' && activeTextCategoryId !== 'uncategorized' ? activeTextCategoryId : '',
                        isDefault: false
                      })}
                      className="gradient-accent text-white px-5 py-2 rounded-xl text-xs font-bold shadow-lg"
                    >
                      + Neue Text-Vorlage
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Defaults */}
                    {activeTextCategoryId === 'all' && DEFAULT_TEXT_TEMPLATE_OPTIONS.map(({ key, label }) => (
                      <div key={key} className="flex items-center justify-between p-4 bg-hover-subtle rounded-xl border border-subtle group hover:border-accent/30 transition-all">
                        <span className="text-sm font-medium text-primary capitalize">
                          {label}
                        </span>
                        <button onClick={() => openDefaultEditor(key)} className="text-[10px] font-bold text-accent uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity">Edit</button>
                      </div>
                    ))}
                    {/* Custom Text Templates */}
                    {filteredTextTemplates.filter(t => !DEFAULT_TEXT_TEMPLATE_OPTIONS.some((entry) => entry.key === t.name)).map(t => (
                      <div key={t.id} className="flex items-center justify-between p-4 bg-hover-subtle rounded-xl border border-subtle group hover:border-accent/30 transition-all">
                        <div className="min-w-0 pr-4">
                          <span className="text-sm font-medium text-primary truncate block">{t.name}</span>
                          <span className="text-[10px] text-secondary">{getCategoryName(t.category_id)}</span>
                        </div>
                        <div className="flex gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => setActiveEditor({...t, isDefault: false})} className="text-[10px] font-bold text-accent uppercase">Edit</button>
                          <button onClick={() => handleDelete(t.id)} className="text-[10px] font-bold text-secondary uppercase hover:text-danger">Löschen</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="bg-surface border border-subtle rounded-2xl p-6 shadow-xl">
                    <h2 className="text-sm font-semibold text-secondary uppercase tracking-widest mb-6">Standard-Modell</h2>
                    <select value={preferredModel} onChange={e => setPreferredModel(e.target.value)} className="w-full bg-surface-elevated border border-subtle rounded-xl px-4 py-2.5 text-sm text-primary outline-none focus:ring-1 focus:ring-accent">
                      <option value="mistral-small-latest">Kostengünstig / Schnell</option>
                      <option value="mistral-medium-latest">Ausgewogen</option>
                      <option value="mistral-large-latest">Qualität</option>
                    </select>
                    <p className="mt-3 text-[10px] text-secondary leading-relaxed italic">
                      Dieses Modell wird standardmäßig für KI-Analyse und Textaufgaben verwendet.
                    </p>
                  </div>
                  <button
                    onClick={handleSaveSettings}
                    disabled={isSavingSettings}
                    className="w-full gradient-accent text-white py-3.5 rounded-2xl font-semibold shadow-lg shadow-accent/20 transition-all hover:scale-[1.01] disabled:opacity-40"
                  >
                    {isSavingSettings ? 'Speichert...' : 'Speichern'}
                  </button>
                </div>
              </div>

            </div>
          )}

          {activeTab === 'table-templates' && (
            <div className="space-y-8 animate-fade-in">
              {renderTemplateCategoryPanel({
                activeCategoryId: activeTableCategoryId,
                onChange: setActiveTableCategoryId,
                templatesForCounts: tableTemplates,
              })}

              {/* Table Templates Section */}
              <div className="bg-surface border border-subtle rounded-2xl p-6 shadow-xl">
                <div className="flex items-center justify-between mb-8">
                  <div>
                    <h2 className="text-sm font-semibold text-secondary uppercase tracking-widest">Tabellen-Templates</h2>
                    <p className="text-xs text-secondary mt-1">
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

                {filteredTableTemplates.length === 0 ? (
                  <div className="text-center py-8 bg-hover-subtle rounded-xl border border-dashed border-subtle">
                    <p className="text-secondary text-sm">
                      Keine Tabellen-Vorlagen in dieser Kategorie.
                    </p>
                    <p className="text-secondary/60 text-xs mt-1">
                      Legen Sie eine Vorlage an oder wählen Sie eine andere Kategorie.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {filteredTableTemplates.map(t => (
                      <div key={t.id} className="flex items-center justify-between p-4 bg-hover-subtle rounded-xl border border-subtle group hover:border-accent/30 transition-all">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center">
                            <svg className="w-4 h-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7-4h14M4 6h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2z" />
                            </svg>
                          </div>
                          <div>
                            <span className="text-sm font-medium text-primary block">{t.name}</span>
                            <span className="text-[10px] text-secondary">
                              {getCategoryName(t.category_id)} •{' '}
                              {t.table_schema?.columns?.length || 0} Spalten
                              {t.table_schema?.rows?.length > 0 && ` • ${t.table_schema.rows.length} Zeilen`}
                              {t.table_schema?.metadata?.length > 0 && ` • ${t.table_schema.metadata.length} Metadaten`}
                            </span>
                          </div>
                        </div>
                        <div className="flex gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => openTableTemplateEditor(t)} className="text-[10px] font-bold text-accent uppercase">Edit</button>
                          <button onClick={() => handleDelete(t.id)} className="text-[10px] font-bold text-secondary uppercase hover:text-danger">Löschen</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'ocr-translate' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-fade-in">
              <div className="bg-surface border border-subtle rounded-2xl p-6 shadow-xl">
                <h2 className="text-sm font-semibold text-secondary uppercase tracking-widest mb-6">OCR (Texterkennung)</h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-secondary mb-1.5">OCR-Modell</label>
                    <select value={ocrModel} onChange={e => setOcrModel(e.target.value)} className="w-full bg-surface-elevated border border-subtle rounded-xl px-4 py-2.5 text-sm text-primary outline-none">
                      <option value="mistral-ocr-latest">Mistral OCR</option>
                    </select>
                  </div>
                  <p className="text-xs text-secondary leading-relaxed italic opacity-70">
                    Mistral OCR ist spezialisiert auf die präzise Textextraktion aus PDF-Dokumenten und Bildern.
                  </p>
                </div>
              </div>
              <div className="bg-surface border border-subtle rounded-2xl p-6 shadow-xl">
                <h2 className="text-sm font-semibold text-secondary uppercase tracking-widest mb-6">Übersetzung</h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-secondary mb-1.5">Standard-Zielsprache</label>
                    <select value={defaultTranslateLanguage} onChange={e => setDefaultTranslateLanguage(e.target.value)} className="w-full bg-surface-elevated border border-subtle rounded-xl px-4 py-2.5 text-sm text-primary outline-none">
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
                    className="w-full gradient-accent text-white py-3.5 rounded-2xl font-semibold shadow-lg shadow-accent/20 transition-all hover:scale-[1.01] disabled:opacity-40"
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
                <div className="bg-surface border border-subtle rounded-2xl p-6 shadow-xl">
                  <h2 className="text-sm font-semibold text-secondary uppercase tracking-widest mb-6">API-Konfiguration</h2>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-secondary mb-1.5">Mistral API-Key</label>
                      <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={apiKeyConfigured ? '••••••••••••••••' : 'Key eingeben'} className="w-full bg-surface-elevated border border-subtle rounded-xl px-4 py-2.5 text-sm text-primary outline-none focus:ring-1 focus:ring-accent" />
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <span className={`text-[11px] ${apiKeyConfigured ? 'text-success' : 'text-secondary'}`}>
                          {apiKeyConfigured ? 'API-Key hinterlegt' : 'Kein API-Key hinterlegt'}
                        </span>
                        <button
                          type="button"
                          onClick={handleClearMistralApiKey}
                          disabled={isClearingMistralKey || isSavingSettings || !apiKeyConfigured}
                          className="text-[11px] text-danger hover:text-red-300 disabled:opacity-40"
                        >
                          {isClearingMistralKey ? 'Entferne...' : 'Key entfernen'}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-secondary mb-1.5">Monatliches Kostenlimit (€)</label>
                      <input type="number" value={costLimit} onChange={e => setCostLimit(e.target.value)} placeholder="Kein Limit" className="w-full bg-surface-elevated border border-subtle rounded-xl px-4 py-2.5 text-sm text-primary outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-secondary mb-1.5">Mitglieder-Budgetlimit / Monat (€)</label>
                      <input
                        type="number"
                        value={memberMonthlyBudgetLimit}
                        onChange={e => setMemberMonthlyBudgetLimit(e.target.value)}
                        placeholder="Optional, überschreibt bei Bedarf das Konto-Limit"
                        className="w-full bg-surface-elevated border border-subtle rounded-xl px-4 py-2.5 text-sm text-primary outline-none"
                      />
                    </div>
                  </div>
                </div>
                <button
                  onClick={handleSaveSettings}
                  disabled={isSavingSettings || isClearingMistralKey}
                  className="w-full gradient-accent text-white py-3.5 rounded-2xl font-semibold shadow-lg shadow-accent/20 transition-all hover:scale-[1.01] disabled:opacity-40"
                >
                  {isSavingSettings ? 'Speichert...' : 'Speichern'}
                </button>
              </div>

              <div className="space-y-6">
                {usage && (
                  <div className="bg-surface border border-subtle rounded-2xl p-6 shadow-xl relative overflow-hidden">
                    <h2 className="text-sm font-semibold text-secondary uppercase tracking-widest mb-6">Verbrauch aktuell</h2>
                    <div className="grid grid-cols-2 gap-4 mb-6">
                      <div className="bg-hover-subtle rounded-xl p-4 border border-subtle">
                        <p className="text-xs text-secondary uppercase font-bold tracking-wider mb-1">Kosten</p>
                        <p className="text-2xl font-bold text-accent">{usage.totalCost?.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</p>
                      </div>
                      <div className="bg-hover-subtle rounded-xl p-4 border border-subtle">
                        <p className="text-xs text-secondary uppercase font-bold tracking-wider mb-1">Anfragen</p>
                        <p className="text-2xl font-bold text-primary">{usage.totalRequests}</p>
                      </div>
                    </div>
                    <div className="space-y-2 border-t border-subtle pt-4">
                      <h3 className="text-xs font-bold text-secondary uppercase mb-2 opacity-70">Preisliste (pro 1M Tokens)</h3>
                      {PRICE_LIST.map(p => (
                        <div key={p.model} className="flex items-center justify-between text-xs">
                          <span className="text-primary">{p.model}</span>
                          <span className="text-secondary">In: {p.input} | Out: {p.output}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {canReadAudit && (
                <div className="bg-surface border border-subtle rounded-2xl p-6 shadow-xl">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-semibold text-secondary uppercase tracking-widest">Audit-Log</h2>
                    <button
                      onClick={handleReloadAudit}
                      disabled={auditLoading}
                      className="text-[11px] text-accent hover:text-info disabled:opacity-40"
                    >
                      {auditLoading ? 'Lädt...' : 'Neu laden'}
                    </button>
                  </div>
                  <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                    {auditEvents.length === 0 && (
                      <p className="text-xs text-secondary">Noch keine kritischen Aktionen protokolliert.</p>
                    )}
                    {auditEvents.map((entry) => (
                      <div key={entry.id} className="rounded-lg border border-subtle bg-hover-subtle px-3 py-2">
                        <p className="text-xs text-primary">{entry.action}</p>
                        <p className="text-[10px] text-secondary mt-1">
                          {new Date(entry.created_at).toLocaleString('de-DE')} {entry.target_type ? `• ${entry.target_type}` : ''}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Text Template Editor Overlay */}
      {activeEditor && (
        <div className="fixed inset-0 z-[60] bg-canvas flex flex-col animate-fade-in">
          <header className="min-h-16 border-b border-subtle bg-surface flex flex-wrap items-center justify-between gap-3 px-6 py-3">
            <div className="flex items-center gap-4 min-w-0 flex-1">
              <button onClick={() => setActiveEditor(null)} className="p-2 text-secondary hover:text-primary transition-colors" aria-label="Vorlagen-Editor schließen"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg></button>
              <input 
                type="text" 
                value={activeEditor.name} 
                onChange={e => setActiveEditor({...activeEditor, name: e.target.value})} 
                disabled={activeEditor.isDefault && DEFAULT_TEXT_TEMPLATE_OPTIONS.some((entry) => entry.key === activeEditor.id)} 
                className="bg-transparent border-none text-lg font-semibold text-primary outline-none focus:ring-0 w-full max-w-md min-w-0"
                placeholder="Name der Vorlage..."
              />
            </div>
            <div className="flex items-center justify-end gap-3 flex-wrap">
              {activeEditor.isDefault && DEFAULT_TEXT_TEMPLATE_OPTIONS.some((entry) => entry.key === activeEditor.id) && <span className="text-[10px] bg-accent/20 text-accent px-2 py-1 rounded-full uppercase">Standard-Vorlage</span>}
              <select
                value={activeEditor.category_id || ''}
                onChange={e => setActiveEditor({ ...activeEditor, category_id: e.target.value })}
                className="bg-surface-elevated border border-subtle rounded-xl px-3 py-2 text-xs text-primary outline-none"
                aria-label="Kategorie der Text-Vorlage"
              >
                <option value="">Ohne Kategorie</option>
                {templateCategories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
              <button onClick={handleSaveTemplate} disabled={templateLoading} className="gradient-accent text-white px-6 py-2 rounded-xl text-sm font-bold shadow-lg shadow-accent/20">
                {templateLoading ? 'Speichert...' : 'Vorlage speichern'}
              </button>
            </div>
          </header>
          <main className="flex-1 p-6 md:p-12 overflow-y-auto bg-hover-subtle">
            <div className="max-w-4xl mx-auto h-full flex flex-col">
              {/* KI Generator Section */}
              <div className="mb-8 bg-surface border border-accent/20 rounded-2xl p-6 shadow-2xl shadow-accent/5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-2 h-2 bg-accent rounded-full animate-pulse" />
                  <h3 className="text-[10px] font-bold text-accent uppercase tracking-[0.2em]">Vorlagen-Generator</h3>
                </div>
                <div className="flex gap-3 items-start">
                  <textarea 
                    value={generatorGoal}
                    onChange={e => setGeneratorGoal(e.target.value)}
                    placeholder="Beschreiben Sie hier detailliert, was die Vorlage leisten soll (z.B. 'Ein Protokoll für ein IT-Team-Meeting, das technische Details und Architektur-Entscheidungen hervorhebt')..." 
                    rows={3}
                    className="flex-1 bg-surface-elevated border border-subtle rounded-xl px-4 py-2.5 text-sm text-primary outline-none focus:ring-1 focus:ring-accent resize-none"
                  />
                  <button 
                    onClick={handleGenerateAI}
                    disabled={isGenerating || !generatorGoal.trim()}
                    className="gradient-accent text-white px-6 py-3 rounded-xl text-xs font-bold shadow-lg disabled:opacity-50 transition-all flex items-center gap-2 shrink-0 h-[46px]"
                  >
                    {isGenerating ? (
                      <>
                        <div className="w-3 h-3 border-2 border-emphasis border-t-white rounded-full animate-spin" />
                        Generiere...
                      </>
                    ) : 'Erstellen'}
                  </button>
                </div>
                <p className="mt-3 text-[10px] text-secondary opacity-60">
                  Aus Ihrer Beschreibung wird eine System-Anweisung mit JSON-Struktur erstellt.
                </p>
              </div>

              <label className="text-[10px] font-bold text-secondary uppercase tracking-widest mb-4">System-Anweisungen (Prompt)</label>
              <textarea 
                value={activeEditor.prompt_text} 
                onChange={e => setActiveEditor({...activeEditor, prompt_text: e.target.value})}
                placeholder="Geben Sie hier die Anweisungen für das Sprachmodell ein..."
                className="flex-1 bg-surface border border-subtle rounded-2xl p-8 text-sm text-primary outline-none focus:border-accent/30 shadow-2xl resize-none font-mono leading-relaxed"
              />
              <p className="mt-4 text-[10px] text-secondary italic">
                Tipp: Beschreiben Sie exakt, wie das Ergebnis strukturiert sein soll (z.B. als JSON oder Fließtext).
              </p>
            </div>
          </main>
        </div>
      )}

      {/* Table Template Editor Overlay */}
      {tableTemplateEditor && (
        <div className="fixed inset-0 z-[60] bg-canvas flex flex-col animate-fade-in">
          <header className="min-h-16 border-b border-subtle bg-surface flex flex-wrap items-center justify-between gap-3 px-6 py-3">
            <div className="flex items-center gap-4 min-w-0 flex-1">
              <button onClick={() => { setTableTemplateEditor(null); setTableSchema(null); }} className="p-2 text-secondary hover:text-primary transition-colors" aria-label="Tabellen-Vorlagen-Editor schließen">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <input 
                type="text" 
                value={tableTemplateEditor.name} 
                onChange={e => handleTableTemplateNameChange(e.target.value)}
                className="bg-transparent border-none text-lg font-semibold text-primary outline-none focus:ring-0 w-full max-w-md min-w-0"
                placeholder="Name der Tabellen-Vorlage..."
              />
            </div>
            <div className="flex items-center justify-end gap-3 flex-wrap">
              <span className="text-[10px] bg-accent/20 text-accent px-2 py-1 rounded-full uppercase">Tabellen-Vorlage</span>
              <select
                value={tableTemplateEditor.category_id || ''}
                onChange={e => setTableTemplateEditor({ ...tableTemplateEditor, category_id: e.target.value })}
                className="bg-surface-elevated border border-subtle rounded-xl px-3 py-2 text-xs text-primary outline-none"
                aria-label="Kategorie der Tabellen-Vorlage"
              >
                <option value="">Ohne Kategorie</option>
                {templateCategories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
              <button 
                type="button"
                onClick={handleSaveTableTemplate} 
                disabled={templateLoading} 
                className="gradient-accent text-white px-6 py-2 rounded-xl text-sm font-bold shadow-lg shadow-accent/20"
              >
                {templateLoading ? 'Speichert...' : 'Vorlage speichern'}
              </button>
            </div>
          </header>
          <main className="flex-1 p-6 md:p-12 overflow-y-auto bg-hover-subtle">
            <div className="max-w-4xl mx-auto">
              <TableSchemaBuilder 
                schema={tableSchema}
                onChange={handleTableSchemaChange}
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
