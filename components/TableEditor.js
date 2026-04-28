import { useCallback, useEffect, useMemo, useState } from 'react';
import TableRenderer from './TableRenderer';
import Toast from './Toast';
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
  sourceLabel = 'Transkript',
}) {
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

  useEffect(() => {
    setTableData({
      metadata: normalizeTableMetadata(initialData?.metadata || {}, normalizedSchema),
      rows: orderRowsBySchema(initialData?.rows || [], normalizedSchema),
      missing_fields_by_row: initialData?.missing_fields_by_row || [],
      missing_metadata_fields: initialData?.missing_metadata_fields || [],
    });
  }, [initialData, normalizedSchema]);

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(tableData);
      setSaveFeedback(true);
      setTimeout(() => setSaveFeedback(false), 2000);
    } catch (error) {
      setToast({ message: error?.message || 'Tabelle konnte nicht gespeichert werden.', type: 'error' });
    } finally {
      setSaving(false);
    }
  }, [onSave, saving, tableData]);

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
    <div className="fixed inset-0 z-[100] bg-dark-bg flex flex-col animate-fade-in">
      <nav className="min-h-16 border-b border-white/[0.06] bg-dark-card flex flex-wrap md:flex-nowrap items-center justify-between gap-2 px-3 md:px-6 py-2 shrink-0">
        <div className="flex items-center gap-3 md:gap-4 min-w-0">
          <button onClick={onCancel} className="p-2 rounded-full transition-all text-text-secondary hover:text-accent-orange bg-white/5">
            <span className="sr-only">Tabellen-Editor schließen</span>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] font-bold text-accent-orange uppercase tracking-widest leading-none">Tabellen-Editor</span>
            <span className="text-sm font-medium text-text-primary truncate max-w-[260px]">{filename}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 md:gap-3 w-full md:w-auto justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className={`px-4 py-2 text-xs font-bold rounded-xl transition-all disabled:opacity-40 ${
              saveFeedback
                ? 'bg-accent-green/20 text-accent-green'
                : 'gradient-accent text-white shadow-lg shadow-accent-orange/20'
            }`}
          >
            {saving ? 'Speichert...' : saveFeedback ? 'Gespeichert!' : 'Speichern ⌘S'}
          </button>
        </div>
      </nav>

      <main className="flex-1 overflow-y-auto bg-[#0a0a0f] custom-scrollbar">
        <div className="w-full max-w-7xl mx-auto px-4 md:px-8 py-8 space-y-4">
          <TableRenderer
            initialData={tableData}
            schema={normalizedSchema}
            filename={filename}
            editable
            alwaysEditing
            onChange={setTableData}
          />

          {sidebarContent && (
            <section className="no-print bg-dark-card border border-white/[0.06] rounded-2xl overflow-hidden">
              <button
                type="button"
                onClick={() => setShowSourceContent((prev) => !prev)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm text-text-primary hover:bg-white/[0.03] transition-colors"
                aria-expanded={showSourceContent}
              >
                <span>{showSourceContent ? `${sourceLabel} ausblenden` : `${sourceLabel} anzeigen`}</span>
                <svg
                  className={`w-4 h-4 text-text-secondary transition-transform ${showSourceContent ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showSourceContent && (
                <div className="border-t border-white/[0.06] px-4 py-4 text-xs text-text-secondary whitespace-pre-wrap leading-relaxed max-h-[320px] overflow-y-auto custom-scrollbar font-mono">
                  {sidebarContent}
                </div>
              )}
            </section>
          )}
        </div>
      </main>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
