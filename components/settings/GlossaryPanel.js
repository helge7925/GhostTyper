import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from '../../lib/i18n';
import { usePermission } from '../../lib/use-permission';
import {
  listGlossaryEntries,
  createGlossaryEntry,
  updateGlossaryEntry,
  deleteGlossaryEntry,
  exportGlossary,
  importGlossaryCsv,
  listTranslationMemory,
  deleteTranslationMemoryEntry,
  purgeUnverifiedTranslationMemory,
} from '../../lib/api';

const TM_PAGE_SIZE = 25;

/**
 * Two-tier glossary management + translation-memory browser (ported from the
 * downstream romaco-scriptor `pages/settings.js`). Extracted into a
 * self-contained panel to match GhostTyper's `components/settings/*Panel.js`
 * convention; feedback (toast/confirm) is provided by the parent so the whole
 * settings surface shares one Toast/ConfirmDialog instance.
 */
export default function GlossaryPanel({ showToast, confirm, defaultTranslateLanguage = 'en' }) {
  const t = useTranslations('settings.glossary');
  const canManageGlossary = usePermission('org.settings');

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

  const [tmEntries, setTmEntries] = useState([]);
  const [tmTotal, setTmTotal] = useState(0);
  const [tmSearch, setTmSearch] = useState('');
  const [tmLoading, setTmLoading] = useState(false);

  const [glossaryIoBusy, setGlossaryIoBusy] = useState('');
  const [glossaryImportErrors, setGlossaryImportErrors] = useState([]);
  const glossaryImportInputRef = useRef(null);
  const glossaryImportScopeRef = useRef('personal');

  const loadTranslationMemoryPage = useCallback(async ({ search = '', offset = 0, append = false } = {}) => {
    setTmLoading(true);
    try {
      const payload = await listTranslationMemory({ q: search, limit: TM_PAGE_SIZE, offset });
      const rows = payload.entries || [];
      setTmEntries((prev) => (append ? [...prev, ...rows] : rows));
      setTmTotal(Number(payload.total || 0));
    } catch {
      showToast(t('tm.loadError'), 'error');
    } finally {
      setTmLoading(false);
    }
  }, [showToast, t]);

  const handleRefreshGlossaryEntries = useCallback(async () => {
    setGlossaryEntriesLoading(true);
    try {
      const [personalPayload, workspacePayload] = await Promise.all([
        listGlossaryEntries('personal'),
        listGlossaryEntries('workspace'),
      ]);
      setPersonalGlossaryEntries(personalPayload.entries || []);
      setWorkspaceGlossaryEntries(workspacePayload.entries || []);
    } catch {
      showToast(t('loadError'), 'error');
    } finally {
      setGlossaryEntriesLoading(false);
    }
  }, [showToast, t]);

  // Load both tiers + the first TM page when the panel first mounts (the tab
  // that renders it is conditionally mounted, so mount == tab activation).
  useEffect(() => {
    handleRefreshGlossaryEntries();
    loadTranslationMemoryPage({ offset: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      title: t('tm.delete'),
      message: t('tm.deleteConfirm'),
      confirmLabel: t('tm.delete'),
      danger: true,
    });
    if (!approved) return;
    try {
      await deleteTranslationMemoryEntry(entry.id);
      setTmEntries((prev) => prev.filter((item) => item.id !== entry.id));
      setTmTotal((prev) => Math.max(0, prev - 1));
      showToast(t('tm.deleteSuccess'), 'success');
    } catch {
      showToast(t('tm.deleteError'), 'error');
    }
  }

  async function handlePurgeUnverifiedTm() {
    if (!canManageGlossary) return;
    const approved = await confirm({
      title: t('tm.purgeUnverified'),
      message: t('tm.purgeConfirm'),
      confirmLabel: t('tm.purgeUnverified'),
      danger: true,
    });
    if (!approved) return;
    try {
      const payload = await purgeUnverifiedTranslationMemory();
      showToast(t('tm.purgeSuccess', { count: payload.purged || 0 }), 'success');
      await loadTranslationMemoryPage({ search: tmSearch.trim(), offset: 0 });
    } catch {
      showToast(t('tm.purgeError'), 'error');
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
      showToast(t('io.exportError'), 'error');
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
        t('io.importSuccess', { imported: result.imported || 0, skipped: result.skipped || 0 }),
        (result.errors || []).length > 0 ? 'info' : 'success',
      );
      await handleRefreshGlossaryEntries();
    } catch {
      showToast(t('io.importError'), 'error');
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
          title={t('io.exportCsv')}
        >
          {glossaryIoBusy === `${scope}:csv` ? '...' : t('io.exportCsv')}
        </button>
        <button
          type="button"
          onClick={() => handleExportGlossary(scope, 'tbx')}
          disabled={glossaryIoBusy === `${scope}:tbx`}
          className="px-2.5 py-2 rounded-xl border border-subtle text-xs text-secondary hover:text-primary hover:border-accent/40 disabled:opacity-40"
          title={t('io.exportTbx')}
        >
          {glossaryIoBusy === `${scope}:tbx` ? '...' : t('io.exportTbx')}
        </button>
        {canImport && (
          <button
            type="button"
            onClick={() => triggerGlossaryImport(scope)}
            disabled={glossaryIoBusy === `${scope}:import`}
            className="px-2.5 py-2 rounded-xl border border-subtle text-xs text-accent-ink hover:border-accent/40 disabled:opacity-40"
            title={t('io.import')}
          >
            {glossaryIoBusy === `${scope}:import` ? '...' : t('io.import')}
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
      showToast(t('saveSuccess'), 'success');
    } catch {
      showToast(t('saveError'), 'error');
    } finally {
      setGlossarySaving(false);
    }
  }

  async function handleDeleteGlossaryEntry(entry, scope = 'personal') {
    const safeScope = scope === 'workspace' ? 'workspace' : 'personal';
    if (safeScope === 'workspace' && !canManageGlossary) return;
    const approved = await confirm({
      title: t('delete'),
      message: t('deleteConfirm'),
      confirmLabel: t('delete'),
      danger: true,
    });
    if (!approved) return;
    try {
      await deleteGlossaryEntry(entry.id, safeScope);
      const setList = safeScope === 'workspace' ? setWorkspaceGlossaryEntries : setPersonalGlossaryEntries;
      setList((prev) => prev.filter((item) => item.id !== entry.id));
      if (glossaryEditor.id === entry.id && glossaryEditor.scope === safeScope) resetGlossaryEditor(safeScope);
      showToast(t('deleteSuccess'), 'success');
    } catch {
      showToast(t('deleteError'), 'error');
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
        <p className="text-sm text-secondary border border-dashed border-subtle rounded-xl p-6">{t('empty')}</p>
      );
    }
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-widest text-secondary">
            <tr className="border-b border-subtle">
              <th className="py-3 pr-4 text-left">{t('sourceTerm')}</th>
              <th className="py-3 pr-4 text-left">{t('targetLang')}</th>
              <th className="py-3 pr-4 text-left">{t('targetTerm')}</th>
              <th className="py-3 pr-4 text-left">{t('notes')}</th>
              {editable && <th className="py-3 text-right">{t('actions')}</th>}
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="border-b border-subtle last:border-0">
                <td className="py-3 pr-4 font-medium text-primary">{entry.source_term}</td>
                <td className="py-3 pr-4 text-secondary">
                  {entry.do_not_translate ? t('doNotTranslate') : entry.target_lang}
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
                        {t('edit')}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteGlossaryEntry(entry, scope)}
                        className="text-xs font-bold text-danger uppercase"
                      >
                        {t('delete')}
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
            <p className="text-sm font-semibold text-warning mb-2">{t('io.importErrorsTitle')}</p>
            <ul className="space-y-1 text-xs text-secondary max-h-40 overflow-y-auto">
              {glossaryImportErrors.map((err, index) => (
                <li key={index}>{t('io.rowError', { line: err.line, message: err.message })}</li>
              ))}
            </ul>
          </div>
        )}
        {/* Mein Glossar — every member manages their own entries. */}
        <section className="bg-surface border border-subtle rounded-2xl p-6 shadow-xl">
          <div className="flex items-start justify-between gap-4 mb-6">
            <div>
              <h2 className="text-sm font-semibold text-secondary uppercase tracking-widest">{t('personalTitle')}</h2>
              <p className="text-sm text-secondary mt-2">{t('personalDescription')}</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => resetGlossaryEditor('personal')}
                className="px-3 py-2 rounded-xl border border-subtle text-xs text-accent-ink hover:border-accent/40"
              >
                {t('addEntry')}
              </button>
              <button
                type="button"
                onClick={handleRefreshGlossaryEntries}
                disabled={glossaryEntriesLoading}
                className="px-3 py-2 rounded-xl border border-subtle text-xs text-secondary hover:text-primary hover:border-accent/40 disabled:opacity-40"
              >
                {glossaryEntriesLoading ? '...' : t('refresh')}
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
              <h2 className="text-sm font-semibold text-secondary uppercase tracking-widest">{t('workspaceTitle')}</h2>
              <p className="text-sm text-secondary mt-2">{t('workspaceDescription')}</p>
              {!canManageGlossary && (
                <p className="text-xs text-warning mt-2 inline-flex items-center gap-1.5">
                  <span aria-hidden="true">🔒</span>{t('workspaceLocked')}
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
                  {t('addEntry')}
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
              <h2 className="text-sm font-semibold text-secondary uppercase tracking-widest">{t('tm.title')}</h2>
              <p className="text-sm text-secondary mt-2">{t('tm.description')}</p>
            </div>
            {canManageGlossary && (
              <button
                type="button"
                onClick={handlePurgeUnverifiedTm}
                className="px-3 py-2 rounded-xl border border-subtle text-xs text-danger hover:border-danger/40 shrink-0"
              >
                {t('tm.purgeUnverified')}
              </button>
            )}
          </div>

          <form onSubmit={handleTmSearchSubmit} className="flex items-center gap-2 mb-4">
            <input
              value={tmSearch}
              onChange={(e) => setTmSearch(e.target.value)}
              placeholder={t('tm.searchPlaceholder')}
              className="flex-1 bg-surface-elevated border border-subtle rounded-xl px-4 py-2.5 text-sm text-primary outline-none focus:ring-1 focus:ring-accent"
            />
            <button
              type="submit"
              disabled={tmLoading}
              className="px-4 py-2.5 rounded-xl border border-subtle text-xs text-secondary hover:text-primary hover:border-accent/40 disabled:opacity-40"
            >
              {tmLoading ? '...' : t('tm.search')}
            </button>
          </form>

          {tmEntries.length === 0 ? (
            <p className="text-sm text-secondary border border-dashed border-subtle rounded-xl p-6">{t('tm.empty')}</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-widest text-secondary">
                    <tr className="border-b border-subtle">
                      <th className="py-3 pr-4 text-left">{t('tm.source')}</th>
                      <th className="py-3 pr-4 text-left">{t('tm.target')}</th>
                      <th className="py-3 pr-4 text-left">{t('tm.lastUsed')}</th>
                      {canManageGlossary && <th className="py-3 text-right">{t('actions')}</th>}
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
                              ✓ {t('tm.verified')}
                            </span>
                          ) : (
                            <span className="mt-1 inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-secondary bg-hover-subtle border border-subtle rounded px-1.5 py-0.5">
                              {t('tm.auto')}
                            </span>
                          )}
                        </td>
                        <td className="py-3 pr-4 text-secondary whitespace-nowrap text-xs">
                          {entry.last_used_at ? new Date(entry.last_used_at).toLocaleDateString() : t('tm.never')}
                        </td>
                        {canManageGlossary && (
                          <td className="py-3 text-right">
                            <button
                              type="button"
                              onClick={() => handleDeleteTmEntry(entry)}
                              className="text-xs font-bold text-danger uppercase"
                            >
                              {t('tm.delete')}
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between gap-4 mt-4">
                <span className="text-xs text-secondary">{t('tm.showing', { count: tmEntries.length, total: tmTotal })}</span>
                {tmEntries.length < tmTotal && (
                  <button
                    type="button"
                    onClick={handleTmLoadMore}
                    disabled={tmLoading}
                    className="px-3 py-2 rounded-xl border border-subtle text-xs text-secondary hover:text-primary hover:border-accent/40 disabled:opacity-40"
                  >
                    {tmLoading ? '...' : t('tm.loadMore')}
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
            {glossaryEditor.id ? t('editEntry') : t('addEntry')}
          </h2>
          <div className="mt-3 flex gap-2" role="group" aria-label={t('scopeLabel')}>
            <button
              type="button"
              onClick={() => switchGlossaryScope('personal')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${editorScope === 'personal' ? 'border-accent bg-accent/10 text-accent-ink' : 'border-subtle text-secondary hover:text-primary'}`}
            >
              {t('scopePersonal')}
            </button>
            <button
              type="button"
              onClick={() => switchGlossaryScope('workspace')}
              disabled={!canManageGlossary}
              title={!canManageGlossary ? t('workspaceLocked') : undefined}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-40 ${editorScope === 'workspace' ? 'border-accent bg-accent/10 text-accent-ink' : 'border-subtle text-secondary hover:text-primary'}`}
            >
              {t('scopeWorkspace')}
            </button>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-secondary mb-1.5">{t('sourceTerm')}</label>
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
          {t('doNotTranslate')}
        </label>
        {!glossaryEditor.do_not_translate && (
          <>
            <div>
              <label className="block text-xs font-medium text-secondary mb-1.5">{t('targetLang')}</label>
              <input
                value={glossaryEditor.target_lang}
                onChange={(e) => setGlossaryEditor((prev) => ({ ...prev, target_lang: e.target.value }))}
                disabled={formDisabled}
                className="w-full bg-surface-elevated border border-subtle rounded-xl px-4 py-2.5 text-sm text-primary outline-none disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary mb-1.5">{t('targetTerm')}</label>
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
          <label className="block text-xs font-medium text-secondary mb-1.5">{t('notes')}</label>
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
            title={formDisabled ? t('workspaceLocked') : undefined}
            className="flex-1 gradient-accent text-white py-3 rounded-2xl font-semibold shadow-lg shadow-accent/20 disabled:opacity-40"
          >
            {glossarySaving ? '...' : t('save')}
          </button>
          <button
            type="button"
            onClick={() => resetGlossaryEditor(editorScope)}
            className="px-4 py-3 rounded-2xl border border-subtle text-sm text-secondary hover:text-primary"
          >
            {t('cancel')}
          </button>
        </div>
        <p className="text-xs text-secondary">{t('bilingualExport')}</p>
      </form>
    </div>
  );
}
