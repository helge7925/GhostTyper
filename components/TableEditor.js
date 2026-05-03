import { useCallback, useEffect, useMemo, useState } from 'react';
import TableRenderer from './TableRenderer';
import Toast from './Toast';
import ConfirmDialog from './ConfirmDialog';
import { useTranslations } from '../lib/i18n';
import {
  normalizeTableMetadata,
  normalizeTableSchema,
  orderRowsBySchema,
} from '../lib/table-schema';

export default function TableEditor({
  initialData,
  schema,
  onSave,
  onCancel,
  filename,
  sidebarContent,
  sourceLabel,
}) {
  const t = useTranslations('tableEditor');
  const tCommon = useTranslations('common');
  const resolvedSourceLabel = sourceLabel || t('sourceTranscript');
  const DISCARD_MESSAGE = t('discardMessage');
  const normalizedSchema = useMemo(() => normalizeTableSchema(schema), [schema]);
  const [tableData, setTableData] = useState(() => ({
    metadata: normalizeTableMetadata(initialData?.metadata || {}, normalizedSchema),
    rows: orderRowsBySchema(initialData?.rows || [], normalizedSchema),
    missing_fields_by_row: initialData?.missing_fields_by_row || [],
    missing_metadata_fields: initialData?.missing_metadata_fields || [],
  }));
  const [saving, setSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState(false);
  const [showSourceContent, setShowSourceContent] = useState(false);
  const [toast, setToast] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);

  useEffect(() => {
    setTableData({
      metadata: normalizeTableMetadata(initialData?.metadata || {}, normalizedSchema),
      rows: orderRowsBySchema(initialData?.rows || [], normalizedSchema),
      missing_fields_by_row: initialData?.missing_fields_by_row || [],
      missing_metadata_fields: initialData?.missing_metadata_fields || [],
    });
    setDirty(false);
  }, [initialData, normalizedSchema]);

  // Warn the browser-native way before reload / tab-close while dirty.
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const handleTableChange = useCallback((next) => {
    setTableData(next);
    setDirty(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(tableData);
      setDirty(false);
      setSaveFeedback(true);
      setTimeout(() => setSaveFeedback(false), 2000);
    } catch (error) {
      setToast({ message: error?.message || t('saveFailed'), type: 'error' });
    } finally {
      setSaving(false);
    }
  }, [onSave, saving, tableData, t]);

  const handleCancelClick = useCallback(() => {
    if (dirty) {
      setConfirmDiscardOpen(true);
    } else {
      onCancel?.();
    }
  }, [dirty, onCancel]);

  const handleConfirmDiscard = useCallback(() => {
    setConfirmDiscardOpen(false);
    setDirty(false);
    onCancel?.();
  }, [onCancel]);

  useEffect(() => {
    const handleShortcut = (event) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key?.toLowerCase() !== 's') return;
      event.preventDefault();
      handleSave();
    };

    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [handleSave]);

  return (
    <div className="fixed inset-0 z-[60] bg-canvas flex flex-col animate-fade-in">
      <nav className="min-h-16 border-b border-subtle bg-surface flex flex-wrap md:flex-nowrap items-center justify-between gap-2 px-3 md:px-6 py-2 shrink-0">
        <div className="flex items-center gap-3 md:gap-4 min-w-0">
          <button onClick={handleCancelClick} className="p-2 rounded-full transition-all text-secondary hover:text-accent bg-hover-subtle">
            <span className="sr-only">{t('closeEditor')}</span>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] font-bold text-accent uppercase tracking-widest leading-none">{t('eyebrow')}</span>
            <span className="text-sm font-medium text-primary truncate max-w-[260px]">{filename}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 md:gap-3 w-full md:w-auto justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className={`px-4 py-2 text-xs font-bold rounded-xl transition-all disabled:opacity-40 ${
              saveFeedback
                ? 'bg-success/20 text-success'
                : 'gradient-accent text-white shadow-lg shadow-accent/20'
            }`}
          >
            {saving ? t('saving') : saveFeedback ? t('saved') : t('saveShortcut')}
          </button>
        </div>
      </nav>

      <main className="flex-1 overflow-y-auto bg-canvas custom-scrollbar">
        <div className="w-full max-w-7xl mx-auto px-4 md:px-8 py-8 space-y-4">
          <TableRenderer
            initialData={tableData}
            schema={normalizedSchema}
            filename={filename}
            editable
            alwaysEditing
            onChange={handleTableChange}
          />

          {sidebarContent && (
            <section className="no-print bg-surface border border-subtle rounded-2xl overflow-hidden">
              <button
                type="button"
                onClick={() => setShowSourceContent((prev) => !prev)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm text-primary hover:bg-hover-subtle transition-colors"
                aria-expanded={showSourceContent}
              >
                <span>{showSourceContent ? t('hideSource', { label: resolvedSourceLabel }) : t('showSource', { label: resolvedSourceLabel })}</span>
                <svg
                  className={`w-4 h-4 text-secondary transition-transform ${showSourceContent ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showSourceContent && (
                <div className="border-t border-subtle px-4 py-4 text-xs text-secondary whitespace-pre-wrap leading-relaxed max-h-[320px] overflow-y-auto custom-scrollbar font-mono">
                  {sidebarContent}
                </div>
              )}
            </section>
          )}
        </div>
      </main>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <ConfirmDialog
        open={confirmDiscardOpen}
        title={t('discardTitle')}
        message={DISCARD_MESSAGE}
        confirmLabel={tCommon('discard')}
        cancelLabel={t('keepEditing')}
        danger
        onConfirm={handleConfirmDiscard}
        onCancel={() => setConfirmDiscardOpen(false)}
      />
    </div>
  );
}
