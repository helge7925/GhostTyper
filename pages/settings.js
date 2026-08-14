import Head from 'next/head';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { useCallback, useState, useEffect, useRef } from 'react';
import { Mic, FileText, Table as TableIcon, Languages, KeyRound, BookOpen } from 'lucide-react';
import LoadingSpinner from '../components/LoadingSpinner';
import Toast from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';
import { usePermission } from '../lib/use-permission';
import { invalidateVexaIntegrationCache } from '../lib/use-vexa-integration';
import { cn } from '../lib/utils';
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
  listGlossaryEntries,
  createGlossaryEntry,
  updateGlossaryEntry,
  deleteGlossaryEntry,
  exportGlossary,
  importGlossaryCsv,
  listTranslationMemory,
  deleteTranslationMemoryEntry,
  purgeUnverifiedTranslationMemory,
  getAuditLog,
} from '../lib/api';
import { CHAT_MODEL_OPTIONS, normalizeDefaultTemplate } from '../lib/constants';
import { DEFAULT_PROMPTS, getPrompt } from '../lib/prompts';
import TableSchemaBuilder from '../components/TableSchemaBuilder';
import { validateTableSchema, buildTableExtractionPrompt } from '../lib/table-calculations';
import { createDefaultTableSchema, normalizeTableSchema } from '../lib/table-schema';
import { useUiFeedback } from '../lib/use-ui-feedback';
import { useTranslations } from '../lib/i18n';
import PersonalBudgetCard from '../components/PersonalBudgetCard';

const SETTINGS_TAB_IDS = ['transcription', 'text-templates', 'table-templates', 'ocr-translate', 'glossary', 'account'];
// Mirror of the canonical workspace list in `lib/workspace-templates.js`
// — keep these two arrays in sync. Aufmaß is intentionally not offered as
// an editable default (legacy DB rows referencing it stay analysable via
// lib/template-service.js).
const DEFAULT_TEXT_TEMPLATE_OPTIONS = [
  { key: 'generic', label: 'Zusammenfassung' },
  { key: 'meeting', label: 'Meeting-Protokoll' },
  { key: 'action_items', label: 'To-Dos' },
  { key: 'fat_sat', label: 'FAT/SAT-Protokoll' },
  { key: 'engineering_review', label: 'Engineering-Review' },
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
  const t = useTranslations('settings');
  const tTabs = useTranslations('settings.tabs');
  const tCommon = useTranslations('common');
  const [defaultTemplate, setDefaultTemplate] = useState('generic');
  const [language, setLanguage] = useState('de');
  const [contextBias, setContextBias] = useState('');
  const [preferredModel, setPreferredModel] = useState('deepseek-v4-pro');
  const [defaultTranslateLanguage, setDefaultTranslateLanguage] = useState('en');
  const [ocrModel, setOcrModel] = useState('mistral-ocr-latest');
  const [remoteMeetingEnabled, setRemoteMeetingEnabled] = useState(true);
  const [vexaWorkspaceEnabled, setVexaWorkspaceEnabled] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

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
  const [personalGlossaryEntries, setPersonalGlossaryEntries] = useState([]);
  const [workspaceGlossaryEntries, setWorkspaceGlossaryEntries] = useState([]);
  const [glossaryEntriesLoading, setGlossaryEntriesLoading] = useState(false);
  const [glossarySaving, setGlossarySaving] = useState(false);
  const [glossaryEditor, setGlossaryEditor] = useState({
    id: null,
    scope: 'personal',
    source_term: '',
    target_lang: defaultTranslateLanguage || 'en',
    target_term: '',
    do_not_translate: false,
    notes: '',
  });
  const TM_PAGE_SIZE = 25;
  const [tmEntries, setTmEntries] = useState([]);
  const [tmTotal, setTmTotal] = useState(0);
  const [tmSearch, setTmSearch] = useState('');
  const [tmLoading, setTmLoading] = useState(false);
  const [glossaryIoBusy, setGlossaryIoBusy] = useState('');
  const [glossaryImportErrors, setGlossaryImportErrors] = useState([]);
  const glossaryImportInputRef = useRef(null);
  const glossaryImportScopeRef = useRef('personal');
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
  const canManageGlossary = usePermission('org.settings');

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
        const [settingsData, templatesData, categoriesData, personalGlossaryData, workspaceGlossaryData] = await Promise.all([
          getSettings(),
          getTemplates(),
          getTemplateCategories(),
          // Both tiers are readable by every member; workspace stays admin-only
          // for writes (enforced server-side + in the UI below).
          listGlossaryEntries('personal').catch(() => ({ entries: [] })),
          listGlossaryEntries('workspace').catch(() => ({ entries: [] })),
        ]);

        setDefaultTemplate(normalizeDefaultTemplate(settingsData.defaultTemplate));
        setLanguage(settingsData.language || 'de');
        setContextBias(settingsData.contextBias || '');
        setPreferredModel(settingsData.preferredModel || 'deepseek-v4-pro');
        setDefaultTranslateLanguage(settingsData.defaultTranslateLanguage || 'en');
        setOcrModel(settingsData.ocrModel || 'mistral-ocr-latest');
        setRemoteMeetingEnabled(settingsData.remoteMeetingEnabled !== false);
        setPersonalGlossaryEntries(personalGlossaryData.entries || []);
        setWorkspaceGlossaryEntries(workspaceGlossaryData.entries || []);

        // Workspace-Vexa-Status getrennt laden, damit der Toggle nur dann
        // angezeigt wird, wenn die Funktion vom Admin überhaupt freigegeben ist.
        try {
          const vexaRes = await fetch('/api/organizations/integrations/vexa', { credentials: 'same-origin' });
          if (vexaRes.ok) {
            const data = await vexaRes.json();
            setVexaWorkspaceEnabled(!!data.enabled);
          }
        } catch {
          /* non-fatal */
        }

        setTemplates(templatesData);
        setTemplateCategories(categoriesData);
      } catch (err) {
        console.error('Failed to load settings or templates:', err);
      } finally {
        setLoading(false);
      }
    };

    loadData();

    if (canReadAudit) {
      getAuditLog(60)
        .then((payload) => setAuditEvents(payload?.events || []))
        .catch(() => {});
    }
  }, [status, router, canReadAudit, canManageGlossary]);

  // Lazy-load the translation-memory browser the first time the glossary tab is
  // opened (TM can be large; no reason to fetch it on every settings visit).
  const tmLoadedRef = useRef(false);
  useEffect(() => {
    if (activeTab !== 'glossary' || tmLoadedRef.current) return;
    tmLoadedRef.current = true;
    loadTranslationMemoryPage({ offset: 0 });
  }, [activeTab, loadTranslationMemoryPage]);

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
        preferredModel,
        defaultTranslateLanguage,
        ocrModel,
        remoteMeetingEnabled,
      };

      await updateSettings(payload);
      invalidateVexaIntegrationCache();

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError('Einstellungen konnten nicht gespeichert werden.');
    } finally {
      setIsSavingSettings(false);
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
      showToast(t('glossary.suggestionsLoadError'), 'error');
    } finally {
      setGlossaryLoading(false);
    }
  }

  async function handleRefreshGlossaryEntries() {
    setGlossaryEntriesLoading(true);
    try {
      const [personalPayload, workspacePayload] = await Promise.all([
        listGlossaryEntries('personal'),
        listGlossaryEntries('workspace'),
      ]);
      setPersonalGlossaryEntries(personalPayload.entries || []);
      setWorkspaceGlossaryEntries(workspacePayload.entries || []);
    } catch {
      showToast(t('glossary.loadError'), 'error');
    } finally {
      setGlossaryEntriesLoading(false);
    }
  }

  const loadTranslationMemoryPage = useCallback(async ({ search = '', offset = 0, append = false } = {}) => {
    setTmLoading(true);
    try {
      const payload = await listTranslationMemory({ q: search, limit: TM_PAGE_SIZE, offset });
      const rows = payload.entries || [];
      setTmEntries((prev) => (append ? [...prev, ...rows] : rows));
      setTmTotal(Number(payload.total || 0));
    } catch {
      showToast(t('glossary.tm.loadError'), 'error');
    } finally {
      setTmLoading(false);
    }
  }, [showToast, t]);

  function handleTmSearchSubmit(e) {
    if (e) e.preventDefault();
    loadTranslationMemoryPage({ search: tmSearch.trim(), offset: 0 });
  }

  function handleTmLoadMore() {
    loadTranslationMemoryPage({ search: tmSearch.trim(), offset: tmEntries.length, append: true });
  }

  async function handleDeleteTmEntry(entry) {
    if (!canManageGlossary) return;
    const approved = await confirm({
      title: t('glossary.tm.delete'),
      message: t('glossary.tm.deleteConfirm'),
      confirmLabel: t('glossary.tm.delete'),
      danger: true,
    });
    if (!approved) return;
    try {
      await deleteTranslationMemoryEntry(entry.id);
      setTmEntries((prev) => prev.filter((item) => item.id !== entry.id));
      setTmTotal((prev) => Math.max(0, prev - 1));
      showToast(t('glossary.tm.deleteSuccess'), 'success');
    } catch {
      showToast(t('glossary.tm.deleteError'), 'error');
    }
  }

  async function handlePurgeUnverifiedTm() {
    if (!canManageGlossary) return;
    const approved = await confirm({
      title: t('glossary.tm.purgeUnverified'),
      message: t('glossary.tm.purgeConfirm'),
      confirmLabel: t('glossary.tm.purgeUnverified'),
      danger: true,
    });
    if (!approved) return;
    try {
      const payload = await purgeUnverifiedTranslationMemory();
      showToast(t('glossary.tm.purgeSuccess', { count: payload.purged || 0 }), 'success');
      await loadTranslationMemoryPage({ search: tmSearch.trim(), offset: 0 });
    } catch {
      showToast(t('glossary.tm.purgeError'), 'error');
    }
  }

  async function handleExportGlossary(scope, format) {
    const safeScope = scope === 'workspace' ? 'workspace' : 'personal';
    setGlossaryIoBusy(`${safeScope}:${format}`);
    try {
      const { text, filename } = await exportGlossary(safeScope, format);
      const mime = format === 'tbx' ? 'application/xml' : 'text/csv';
      const blob = new Blob([text], { type: `${mime};charset=utf-8` });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
    } catch {
      showToast(t('glossary.io.exportError'), 'error');
    } finally {
      setGlossaryIoBusy('');
    }
  }

  function triggerGlossaryImport(scope) {
    const safeScope = scope === 'workspace' ? 'workspace' : 'personal';
    if (safeScope === 'workspace' && !canManageGlossary) return;
    glossaryImportScopeRef.current = safeScope;
    setGlossaryImportErrors([]);
    if (glossaryImportInputRef.current) {
      glossaryImportInputRef.current.value = '';
      glossaryImportInputRef.current.click();
    }
  }

  async function handleGlossaryImportFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const scope = glossaryImportScopeRef.current === 'workspace' ? 'workspace' : 'personal';
    setGlossaryIoBusy(`${scope}:import`);
    setGlossaryImportErrors([]);
    try {
      const csv = await file.text();
      const result = await importGlossaryCsv(scope, csv);
      setGlossaryImportErrors(result.errors || []);
      showToast(
        t('glossary.io.importSuccess', { imported: result.imported || 0, skipped: result.skipped || 0 }),
        (result.errors || []).length > 0 ? 'info' : 'success',
      );
      await handleRefreshGlossaryEntries();
    } catch {
      showToast(t('glossary.io.importError'), 'error');
    } finally {
      setGlossaryIoBusy('');
    }
  }

  function renderGlossaryIoButtons(scope, canImport) {
    return (
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => handleExportGlossary(scope, 'csv')}
          disabled={glossaryIoBusy === `${scope}:csv`}
          className="px-2.5 py-2 rounded-xl border border-subtle text-xs text-secondary hover:text-primary hover:border-accent/40 disabled:opacity-40"
          title={t('glossary.io.exportCsv')}
        >
          {glossaryIoBusy === `${scope}:csv` ? '...' : t('glossary.io.exportCsv')}
        </button>
        <button
          type="button"
          onClick={() => handleExportGlossary(scope, 'tbx')}
          disabled={glossaryIoBusy === `${scope}:tbx`}
          className="px-2.5 py-2 rounded-xl border border-subtle text-xs text-secondary hover:text-primary hover:border-accent/40 disabled:opacity-40"
          title={t('glossary.io.exportTbx')}
        >
          {glossaryIoBusy === `${scope}:tbx` ? '...' : t('glossary.io.exportTbx')}
        </button>
        {canImport && (
          <button
            type="button"
            onClick={() => triggerGlossaryImport(scope)}
            disabled={glossaryIoBusy === `${scope}:import`}
            className="px-2.5 py-2 rounded-xl border border-subtle text-xs text-accent-ink hover:border-accent/40 disabled:opacity-40"
            title={t('glossary.io.import')}
          >
            {glossaryIoBusy === `${scope}:import` ? '...' : t('glossary.io.import')}
          </button>
        )}
      </div>
    );
  }

  function resetGlossaryEditor(scope = 'personal') {
    setGlossaryEditor({
      id: null,
      scope: scope === 'workspace' ? 'workspace' : 'personal',
      source_term: '',
      target_lang: defaultTranslateLanguage || 'en',
      target_term: '',
      do_not_translate: false,
      notes: '',
    });
  }

  function editGlossaryEntry(entry, scope = 'personal') {
    setGlossaryEditor({
      id: entry.id,
      scope: scope === 'workspace' ? 'workspace' : 'personal',
      source_term: entry.source_term || '',
      target_lang: entry.target_lang || defaultTranslateLanguage || 'en',
      target_term: entry.target_term || '',
      do_not_translate: !!entry.do_not_translate,
      notes: entry.notes || '',
    });
  }

  async function handleSaveGlossaryEntry(e) {
    if (e) e.preventDefault();
    const scope = glossaryEditor.scope === 'workspace' ? 'workspace' : 'personal';
    // Workspace writes require admin rights; personal writes are open to all.
    if (scope === 'workspace' && !canManageGlossary) return;
    setGlossarySaving(true);
    try {
      const payload = {
        source_term: glossaryEditor.source_term,
        target_lang: glossaryEditor.target_lang,
        target_term: glossaryEditor.target_term,
        do_not_translate: glossaryEditor.do_not_translate,
        notes: glossaryEditor.notes,
      };
      const saved = glossaryEditor.id
        ? await updateGlossaryEntry(glossaryEditor.id, payload, scope)
        : await createGlossaryEntry(payload, scope);
      const setList = scope === 'workspace' ? setWorkspaceGlossaryEntries : setPersonalGlossaryEntries;
      setList((prev) => {
        if (!glossaryEditor.id) return [...prev, saved].sort((a, b) => a.source_term.localeCompare(b.source_term));
        return prev.map((entry) => (entry.id === saved.id ? saved : entry));
      });
      resetGlossaryEditor(scope);
      showToast(t('glossary.saveSuccess'), 'success');
    } catch {
      showToast(t('glossary.saveError'), 'error');
    } finally {
      setGlossarySaving(false);
    }
  }

  async function handleDeleteGlossaryEntry(entry, scope = 'personal') {
    const safeScope = scope === 'workspace' ? 'workspace' : 'personal';
    if (safeScope === 'workspace' && !canManageGlossary) return;
    const approved = await confirm({
      title: t('glossary.delete'),
      message: t('glossary.deleteConfirm'),
      confirmLabel: t('glossary.delete'),
      danger: true,
    });
    if (!approved) return;
    try {
      await deleteGlossaryEntry(entry.id, safeScope);
      const setList = safeScope === 'workspace' ? setWorkspaceGlossaryEntries : setPersonalGlossaryEntries;
      setList((prev) => prev.filter((item) => item.id !== entry.id));
      if (glossaryEditor.id === entry.id && glossaryEditor.scope === safeScope) resetGlossaryEditor(safeScope);
      showToast(t('glossary.deleteSuccess'), 'success');
    } catch {
      showToast(t('glossary.deleteError'), 'error');
    }
  }

  function switchGlossaryScope(scope) {
    const safeScope = scope === 'workspace' ? 'workspace' : 'personal';
    if (safeScope === 'workspace' && !canManageGlossary) return;
    // Keep the id only when the scope is unchanged; switching tiers turns the
    // editor into a fresh add for the target tier (an id belongs to one tier).
    setGlossaryEditor((prev) => ({
      ...prev,
      scope: safeScope,
      id: prev.scope === safeScope ? prev.id : null,
    }));
  }

  function renderGlossaryTable({ entries, scope, editable }) {
    if (!entries || entries.length === 0) {
      return (
        <p className="text-sm text-secondary border border-dashed border-subtle rounded-xl p-6">{t('glossary.empty')}</p>
      );
    }
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-widest text-secondary">
            <tr className="border-b border-subtle">
              <th className="py-3 pr-4 text-left">{t('glossary.sourceTerm')}</th>
              <th className="py-3 pr-4 text-left">{t('glossary.targetLang')}</th>
              <th className="py-3 pr-4 text-left">{t('glossary.targetTerm')}</th>
              <th className="py-3 pr-4 text-left">{t('glossary.notes')}</th>
              {editable && <th className="py-3 text-right">{t('glossary.actions')}</th>}
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="border-b border-subtle last:border-0">
                <td className="py-3 pr-4 font-medium text-primary">{entry.source_term}</td>
                <td className="py-3 pr-4 text-secondary">
                  {entry.do_not_translate ? t('glossary.doNotTranslate') : entry.target_lang}
                </td>
                <td className="py-3 pr-4 text-primary">{entry.do_not_translate ? entry.source_term : entry.target_term}</td>
                <td className="py-3 pr-4 text-secondary max-w-[260px] truncate">{entry.notes || '-'}</td>
                {editable && (
                  <td className="py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => editGlossaryEntry(entry, scope)}
                        className="text-xs font-bold text-accent-ink uppercase"
                      >
                        {t('glossary.edit')}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteGlossaryEntry(entry, scope)}
                        className="text-xs font-bold text-danger uppercase"
                      >
                        {t('glossary.delete')}
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
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
    { id: 'transcription', label: tTabs('transcription'), Icon: Mic },
    { id: 'text-templates', label: tTabs('textTemplates'), Icon: FileText },
    { id: 'table-templates', label: tTabs('tableTemplates'), Icon: TableIcon },
    { id: 'ocr-translate', label: tTabs('ocrTranslate'), Icon: Languages },
    { id: 'glossary', label: tTabs('glossary'), Icon: BookOpen },
    { id: 'account', label: tTabs('account'), Icon: KeyRound },
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
                ? 'bg-accent-fill text-white border-accent'
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
                ? 'bg-accent-fill text-white border-accent'
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
                      String(activeCategoryId) === String(cat.id) ? 'text-accent-ink' : 'text-primary hover:text-accent-ink'
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
            <button type="submit" disabled={!newCategoryName.trim()} className="text-accent-ink hover:text-accent-ink/80 disabled:opacity-30" aria-label="Kategorie erstellen">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            </button>
          </form>
        </div>
      </div>
    );
  };

  return (
    <>
      <Head><title>{`${t('title')} – GhostTyper`}</title></Head>

      <div className={(activeEditor || tableTemplateEditor) ? 'hidden' : 'max-w-6xl mx-auto animate-fade-in pb-20'}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <h1 className="text-2xl font-bold text-primary">{t('title')}</h1>
          {saved && <p className="text-success text-xs animate-pulse bg-success/10 px-3 py-1 rounded-full border border-success/20">Einstellungen gespeichert!</p>}
        </div>

        <div className="lg:grid lg:grid-cols-[240px_1fr] lg:gap-8">
          {/* Mobile (<md): native select dropdown */}
          <div className="md:hidden mb-6">
            <label htmlFor="settings-section" className="block text-[10px] font-bold text-secondary uppercase tracking-widest mb-1.5">
              Bereich
            </label>
            <select
              id="settings-section"
              value={activeTab}
              onChange={(event) => handleTabChange(event.target.value)}
              className="w-full bg-surface border border-subtle rounded-xl px-3 py-2.5 text-sm text-primary outline-none focus:ring-2 focus:ring-accent"
            >
              {TABS.map((tab) => (
                <option key={tab.id} value={tab.id}>{tab.label}</option>
              ))}
            </select>
          </div>

          {/* Tablet (md..lg): horizontal tab bar */}
          <div
            className="hidden md:flex lg:hidden items-center gap-1 bg-hover-subtle p-1 rounded-2xl mb-6 overflow-x-auto no-scrollbar border border-subtle"
            role="tablist"
            aria-label="Einstellungen-Bereiche"
          >
            {TABS.map((tab) => {
              const Icon = tab.Icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id)}
                  role="tab"
                  id={`settings-tab-${tab.id}`}
                  aria-selected={activeTab === tab.id}
                  aria-controls={`settings-panel-${tab.id}`}
                  tabIndex={activeTab === tab.id ? 0 : -1}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap',
                    activeTab === tab.id
                      ? 'bg-accent-fill text-white shadow-lg shadow-accent/20'
                      : 'text-secondary hover:text-primary hover:bg-hover-subtle',
                  )}
                >
                  <Icon className="w-4 h-4" aria-hidden="true" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Desktop (lg+): vertical sidebar tabs left of content */}
          <nav
            className="hidden lg:flex flex-col gap-0.5 sticky top-20 self-start"
            role="tablist"
            aria-label="Einstellungen-Bereiche"
          >
            {TABS.map((tab) => {
              const Icon = tab.Icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id)}
                  role="tab"
                  id={`settings-tab-${tab.id}`}
                  aria-selected={activeTab === tab.id}
                  aria-controls={`settings-panel-${tab.id}`}
                  tabIndex={activeTab === tab.id ? 0 : -1}
                  className={cn(
                    'flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors text-left',
                    activeTab === tab.id
                      ? 'bg-accent/10 text-accent-ink'
                      : 'text-secondary hover:text-primary hover:bg-hover-subtle',
                  )}
                  aria-current={activeTab === tab.id ? 'page' : undefined}
                >
                  <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{tab.label}</span>
                </button>
              );
            })}
          </nav>

        <div
          className="space-y-8 lg:min-w-0"
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
                          className="text-[10px] text-accent-ink hover:text-info disabled:opacity-40"
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
                                className="px-2.5 py-1 rounded-full text-[11px] border border-accent/30 bg-accent/10 text-accent-ink hover:bg-accent/20 transition-colors"
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
                    Für die Transkription wird standardmäßig <strong>Cortecs Whisper Large v3</strong> verwendet.
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
                        <button onClick={() => openDefaultEditor(key)} className="text-[10px] font-bold text-accent-ink uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity">Edit</button>
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
                          <button onClick={() => setActiveEditor({...t, isDefault: false})} className="text-[10px] font-bold text-accent-ink uppercase">Edit</button>
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
                      {CHAT_MODEL_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <p className="mt-3 text-[10px] text-secondary leading-relaxed italic">
                      Dieses Modell wird standardmäßig für KI-Analyse und Textaufgaben verwendet.
                    </p>
                  </div>

                  {vexaWorkspaceEnabled && (
                    <div className="bg-surface border border-subtle rounded-2xl p-6 shadow-xl">
                      <h2 className="text-sm font-semibold text-secondary uppercase tracking-widest mb-3">Remote-Meeting</h2>
                      <label className="flex items-start justify-between gap-4 cursor-pointer">
                        <div>
                          <p className="text-sm text-primary font-medium">Funktion für mich aktivieren</p>
                          <p className="text-xs text-secondary mt-0.5 max-w-prose">
                            Wenn aktiviert, erscheint &quot;Remote Meeting&quot; in deiner Sidebar und du kannst Bots zu Google-Meet- oder Teams-Calls schicken.
                            Workspace-Admins steuern die Funktion zusätzlich global.
                          </p>
                        </div>
                        <input
                          type="checkbox"
                          className="sr-only peer"
                          checked={remoteMeetingEnabled}
                          onChange={(e) => setRemoteMeetingEnabled(e.target.checked)}
                        />
                        <span className="w-10 h-6 shrink-0 rounded-full bg-subtle peer-checked:bg-accent transition-colors relative after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-5 after:h-5 after:bg-white after:rounded-full after:transition-transform peer-checked:after:translate-x-4" />
                      </label>
                    </div>
                  )}

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
                            <svg className="w-4 h-4 text-accent-ink" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                          <button onClick={() => openTableTemplateEditor(t)} className="text-[10px] font-bold text-accent-ink uppercase">Edit</button>
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

          {activeTab === 'glossary' && (() => {
            const editorScope = glossaryEditor.scope === 'workspace' ? 'workspace' : 'personal';
            const formDisabled = editorScope === 'workspace' && !canManageGlossary;
            return (
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-8 animate-fade-in">
              <input
                ref={glossaryImportInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleGlossaryImportFile}
                className="hidden"
              />
              <div className="space-y-8">
                {glossaryImportErrors.length > 0 && (
                  <div className="bg-warning/10 border border-warning/20 rounded-2xl p-4">
                    <p className="text-sm font-semibold text-warning mb-2">{t('glossary.io.importErrorsTitle')}</p>
                    <ul className="space-y-1 text-xs text-secondary max-h-40 overflow-y-auto">
                      {glossaryImportErrors.map((err, index) => (
                        <li key={index}>{t('glossary.io.rowError', { line: err.line, message: err.message })}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {/* Mein Glossar — every member manages their own entries. */}
                <section className="bg-surface border border-subtle rounded-2xl p-6 shadow-xl">
                  <div className="flex items-start justify-between gap-4 mb-6">
                    <div>
                      <h2 className="text-sm font-semibold text-secondary uppercase tracking-widest">{t('glossary.personalTitle')}</h2>
                      <p className="text-sm text-secondary mt-2">{t('glossary.personalDescription')}</p>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => resetGlossaryEditor('personal')}
                        className="px-3 py-2 rounded-xl border border-subtle text-xs text-accent-ink hover:border-accent/40"
                      >
                        {t('glossary.addEntry')}
                      </button>
                      <button
                        type="button"
                        onClick={handleRefreshGlossaryEntries}
                        disabled={glossaryEntriesLoading}
                        className="px-3 py-2 rounded-xl border border-subtle text-xs text-secondary hover:text-primary hover:border-accent/40 disabled:opacity-40"
                      >
                        {glossaryEntriesLoading ? '...' : t('glossary.refresh')}
                      </button>
                      {renderGlossaryIoButtons('personal', true)}
                    </div>
                  </div>
                  {renderGlossaryTable({ entries: personalGlossaryEntries, scope: 'personal', editable: true })}
                </section>

                {/* Workspace-Glossar — visible to all, editable by admins only. */}
                <section className="bg-surface border border-subtle rounded-2xl p-6 shadow-xl">
                  <div className="flex items-start justify-between gap-4 mb-6">
                    <div>
                      <h2 className="text-sm font-semibold text-secondary uppercase tracking-widest">{t('glossary.workspaceTitle')}</h2>
                      <p className="text-sm text-secondary mt-2">{t('glossary.workspaceDescription')}</p>
                      {!canManageGlossary && (
                        <p className="text-xs text-warning mt-2 inline-flex items-center gap-1.5">
                          <span aria-hidden="true">🔒</span>{t('glossary.workspaceLocked')}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
                      {canManageGlossary && (
                        <button
                          type="button"
                          onClick={() => resetGlossaryEditor('workspace')}
                          className="px-3 py-2 rounded-xl border border-subtle text-xs text-accent-ink hover:border-accent/40"
                        >
                          {t('glossary.addEntry')}
                        </button>
                      )}
                      {renderGlossaryIoButtons('workspace', canManageGlossary)}
                    </div>
                  </div>
                  {renderGlossaryTable({ entries: workspaceGlossaryEntries, scope: 'workspace', editable: canManageGlossary })}
                </section>

                {/* Übersetzungsgedächtnis — cached translations, verified corrections win. */}
                <section className="bg-surface border border-subtle rounded-2xl p-6 shadow-xl">
                  <div className="flex items-start justify-between gap-4 mb-5">
                    <div>
                      <h2 className="text-sm font-semibold text-secondary uppercase tracking-widest">{t('glossary.tm.title')}</h2>
                      <p className="text-sm text-secondary mt-2">{t('glossary.tm.description')}</p>
                    </div>
                    {canManageGlossary && (
                      <button
                        type="button"
                        onClick={handlePurgeUnverifiedTm}
                        className="px-3 py-2 rounded-xl border border-subtle text-xs text-danger hover:border-danger/40 shrink-0"
                      >
                        {t('glossary.tm.purgeUnverified')}
                      </button>
                    )}
                  </div>

                  <form onSubmit={handleTmSearchSubmit} className="flex items-center gap-2 mb-4">
                    <input
                      value={tmSearch}
                      onChange={(e) => setTmSearch(e.target.value)}
                      placeholder={t('glossary.tm.searchPlaceholder')}
                      className="flex-1 bg-surface-elevated border border-subtle rounded-xl px-4 py-2.5 text-sm text-primary outline-none focus:ring-1 focus:ring-accent"
                    />
                    <button
                      type="submit"
                      disabled={tmLoading}
                      className="px-4 py-2.5 rounded-xl border border-subtle text-xs text-secondary hover:text-primary hover:border-accent/40 disabled:opacity-40"
                    >
                      {tmLoading ? '...' : t('glossary.tm.search')}
                    </button>
                  </form>

                  {tmEntries.length === 0 ? (
                    <p className="text-sm text-secondary border border-dashed border-subtle rounded-xl p-6">{t('glossary.tm.empty')}</p>
                  ) : (
                    <>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="text-xs uppercase tracking-widest text-secondary">
                            <tr className="border-b border-subtle">
                              <th className="py-3 pr-4 text-left">{t('glossary.tm.source')}</th>
                              <th className="py-3 pr-4 text-left">{t('glossary.tm.target')}</th>
                              <th className="py-3 pr-4 text-left">{t('glossary.tm.lastUsed')}</th>
                              {canManageGlossary && <th className="py-3 text-right">{t('glossary.actions')}</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {tmEntries.map((entry) => (
                              <tr key={entry.id} className="border-b border-subtle last:border-0 align-top">
                                <td className="py-3 pr-4 text-primary max-w-[240px]">
                                  <span className="line-clamp-2 break-words">{entry.source_text}</span>
                                  <span className="mt-1 inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-secondary">
                                    {entry.source_lang} → {entry.target_lang}
                                  </span>
                                </td>
                                <td className="py-3 pr-4 text-secondary max-w-[240px]">
                                  <span className="line-clamp-2 break-words">{entry.target_text}</span>
                                  {entry.verified ? (
                                    <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-success bg-success/10 border border-success/20 rounded px-1.5 py-0.5">
                                      ✓ {t('glossary.tm.verified')}
                                    </span>
                                  ) : (
                                    <span className="mt-1 inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-secondary bg-hover-subtle border border-subtle rounded px-1.5 py-0.5">
                                      {t('glossary.tm.auto')}
                                    </span>
                                  )}
                                </td>
                                <td className="py-3 pr-4 text-secondary whitespace-nowrap text-xs">
                                  {entry.last_used_at ? new Date(entry.last_used_at).toLocaleDateString() : t('glossary.tm.never')}
                                </td>
                                {canManageGlossary && (
                                  <td className="py-3 text-right">
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteTmEntry(entry)}
                                      className="text-xs font-bold text-danger uppercase"
                                    >
                                      {t('glossary.tm.delete')}
                                    </button>
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="flex items-center justify-between gap-4 mt-4">
                        <span className="text-xs text-secondary">{t('glossary.tm.showing', { count: tmEntries.length, total: tmTotal })}</span>
                        {tmEntries.length < tmTotal && (
                          <button
                            type="button"
                            onClick={handleTmLoadMore}
                            disabled={tmLoading}
                            className="px-3 py-2 rounded-xl border border-subtle text-xs text-secondary hover:text-primary hover:border-accent/40 disabled:opacity-40"
                          >
                            {tmLoading ? '...' : t('glossary.tm.loadMore')}
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </section>
              </div>

              <form onSubmit={handleSaveGlossaryEntry} className="bg-surface border border-subtle rounded-2xl p-6 shadow-xl space-y-4 self-start">
                <div>
                  <h2 className="text-sm font-semibold text-secondary uppercase tracking-widest">
                    {glossaryEditor.id ? t('glossary.editEntry') : t('glossary.addEntry')}
                  </h2>
                  <div className="mt-3 flex gap-2" role="group" aria-label={t('glossary.scopeLabel')}>
                    <button
                      type="button"
                      onClick={() => switchGlossaryScope('personal')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${editorScope === 'personal' ? 'border-accent bg-accent/10 text-accent-ink' : 'border-subtle text-secondary hover:text-primary'}`}
                    >
                      {t('glossary.scopePersonal')}
                    </button>
                    <button
                      type="button"
                      onClick={() => switchGlossaryScope('workspace')}
                      disabled={!canManageGlossary}
                      title={!canManageGlossary ? t('glossary.workspaceLocked') : undefined}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-40 ${editorScope === 'workspace' ? 'border-accent bg-accent/10 text-accent-ink' : 'border-subtle text-secondary hover:text-primary'}`}
                    >
                      {t('glossary.scopeWorkspace')}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1.5">{t('glossary.sourceTerm')}</label>
                  <input
                    value={glossaryEditor.source_term}
                    onChange={(e) => setGlossaryEditor((prev) => ({ ...prev, source_term: e.target.value }))}
                    disabled={formDisabled}
                    className="w-full bg-surface-elevated border border-subtle rounded-xl px-4 py-2.5 text-sm text-primary outline-none disabled:opacity-50"
                  />
                </div>
                <label className="flex items-center gap-3 text-sm text-primary">
                  <input
                    type="checkbox"
                    checked={glossaryEditor.do_not_translate}
                    onChange={(e) => setGlossaryEditor((prev) => ({ ...prev, do_not_translate: e.target.checked }))}
                    disabled={formDisabled}
                    className="w-4 h-4 accent-accent"
                  />
                  {t('glossary.doNotTranslate')}
                </label>
                {!glossaryEditor.do_not_translate && (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-secondary mb-1.5">{t('glossary.targetLang')}</label>
                      <input
                        value={glossaryEditor.target_lang}
                        onChange={(e) => setGlossaryEditor((prev) => ({ ...prev, target_lang: e.target.value }))}
                        disabled={formDisabled}
                        className="w-full bg-surface-elevated border border-subtle rounded-xl px-4 py-2.5 text-sm text-primary outline-none disabled:opacity-50"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-secondary mb-1.5">{t('glossary.targetTerm')}</label>
                      <input
                        value={glossaryEditor.target_term}
                        onChange={(e) => setGlossaryEditor((prev) => ({ ...prev, target_term: e.target.value }))}
                        disabled={formDisabled}
                        className="w-full bg-surface-elevated border border-subtle rounded-xl px-4 py-2.5 text-sm text-primary outline-none disabled:opacity-50"
                      />
                    </div>
                  </>
                )}
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1.5">{t('glossary.notes')}</label>
                  <textarea
                    value={glossaryEditor.notes}
                    onChange={(e) => setGlossaryEditor((prev) => ({ ...prev, notes: e.target.value }))}
                    disabled={formDisabled}
                    rows={3}
                    className="w-full bg-surface-elevated border border-subtle rounded-xl px-4 py-2.5 text-sm text-primary outline-none disabled:opacity-50"
                  />
                </div>
                <div className="flex gap-3">
                  <button
                    type="submit"
                    disabled={formDisabled || glossarySaving}
                    title={formDisabled ? t('glossary.workspaceLocked') : undefined}
                    className="flex-1 bg-accent-fill hover:bg-accent-fill-hover text-white py-3 rounded-2xl font-semibold transition-colors disabled:opacity-40"
                  >
                    {glossarySaving ? '...' : t('glossary.save')}
                  </button>
                  <button
                    type="button"
                    onClick={() => resetGlossaryEditor(editorScope)}
                    className="px-4 py-3 rounded-2xl border border-subtle text-sm text-secondary hover:text-primary"
                  >
                    {t('glossary.cancel')}
                  </button>
                </div>
                <p className="text-xs text-secondary">{t('glossary.bilingualExport')}</p>
              </form>
            </div>
            );
          })()}

          {activeTab === 'account' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-fade-in">
              <div className="space-y-6">
                <PersonalBudgetCard />
              </div>

              <div className="space-y-6">
                {canReadAudit && (
                <div className="bg-surface border border-subtle rounded-2xl p-6 shadow-xl">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-semibold text-secondary uppercase tracking-widest">Audit-Log</h2>
                    <button
                      onClick={handleReloadAudit}
                      disabled={auditLoading}
                      className="text-[11px] text-accent-ink hover:text-info disabled:opacity-40"
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
              {activeEditor.isDefault && DEFAULT_TEXT_TEMPLATE_OPTIONS.some((entry) => entry.key === activeEditor.id) && <span className="text-[10px] bg-accent/20 text-accent-ink px-2 py-1 rounded-full uppercase">Standard-Vorlage</span>}
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
                  <h3 className="text-[10px] font-bold text-accent-ink uppercase tracking-[0.2em]">Vorlagen-Generator</h3>
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
              <span className="text-[10px] bg-accent/20 text-accent-ink px-2 py-1 rounded-full uppercase">Tabellen-Vorlage</span>
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
