import { useCallback, useEffect, useRef, useState } from 'react';
import { Library, Check, Plus } from 'lucide-react';
import { useTranslations } from '../lib/i18n';

/**
 * Per-document action (Dateien) to add a workspace document to a knowledge
 * base. Lazily loads the user's knowledge bases on first open and POSTs to
 * `/api/knowledge/[id]/items`. Only meaningful for workspace-visible docs.
 */
export default function AddToKnowledgeButton({ documentId, displayName = '' }) {
  const t = useTranslations('knowledgePage');
  const [open, setOpen] = useState(false);
  const [bases, setBases] = useState(null);
  const [addedTo, setAddedTo] = useState(() => new Set());
  const [busyId, setBusyId] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const loadBases = useCallback(async () => {
    try {
      const res = await fetch('/api/knowledge', { credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      setBases(Array.isArray(data.knowledgeBases) ? data.knowledgeBases : []);
    } catch {
      setBases([]);
    }
  }, []);

  const toggle = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen((v) => {
      if (!v && bases === null) loadBases();
      return !v;
    });
  }, [bases, loadBases]);

  const addTo = useCallback(async (kbId, e) => {
    e.preventDefault();
    e.stopPropagation();
    setBusyId(kbId);
    try {
      const res = await fetch(`/api/knowledge/${kbId}/items`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId }),
      });
      if (res.ok) setAddedTo((prev) => new Set(prev).add(kbId));
    } catch {
      /* surfaced via lack of check mark */
    } finally {
      setBusyId(null);
    }
  }, [documentId]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={toggle}
        className="p-2 text-secondary hover:text-accent hover:bg-accent/10 rounded-lg transition-all"
        title={t('addTo')}
        aria-label={`${displayName} — ${t('addTo')}`}
      >
        <Library className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute z-30 right-0 mt-1 w-60 bg-surface-elevated border border-subtle rounded-xl shadow-lg p-1.5" onClick={(e) => e.stopPropagation()}>
          {bases === null ? (
            <p className="px-2 py-2 text-[11px] text-secondary">{t('searching')}</p>
          ) : bases.length === 0 ? (
            <p className="px-2 py-2 text-[11px] text-secondary">{t('noBasesShort')}</p>
          ) : (
            <ul className="max-h-56 overflow-y-auto custom-scrollbar">
              {bases.map((b) => {
                const added = addedTo.has(b.id);
                return (
                  <li key={b.id}>
                    <button
                      type="button"
                      onClick={(e) => (added ? e.stopPropagation() : addTo(b.id, e))}
                      disabled={busyId === b.id || added}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-xs text-primary hover:bg-subtle disabled:opacity-70 transition-colors"
                    >
                      {added ? <Check className="w-3 h-3 text-accent shrink-0" /> : <Plus className="w-3 h-3 text-secondary shrink-0" />}
                      <span className="truncate" title={b.name}>{b.name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
