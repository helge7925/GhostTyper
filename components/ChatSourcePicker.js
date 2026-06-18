import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, FileText, Paperclip, Search, Upload } from 'lucide-react';
import { useTranslations } from '../lib/i18n';

/**
 * Paperclip attach control for the chat composer. Opens a popover with a single
 * search across documents AND workspace knowledge bases (no tabs), shows recent
 * sources when the search is empty, and — if `onUpload` is provided — lets the
 * user upload a brand-new file that gets ingested + auto-attached.
 */
export default function ChatSourcePicker({ items = [], onAdd, onUpload, disabled = false }) {
  const t = useTranslations('chatPage');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState({ documents: [], knowledge: [] });
  const [searching, setSearching] = useState(false);
  const boxRef = useRef(null);
  const debounceRef = useRef(null);
  const fileInputRef = useRef(null);

  const attachedDocumentIds = new Set(items.filter((it) => it.context_type !== 'knowledge_base').map((it) => it.document_id));
  const attachedKnowledgeIds = new Set(items.filter((it) => it.context_type === 'knowledge_base').map((it) => it.knowledge_base_id));

  // Close on outside click.
  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  // Debounced combined search; empty term shows recents (first page of each).
  useEffect(() => {
    if (!open) return undefined;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const term = search.trim();
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const docParams = new URLSearchParams();
        if (term) { docParams.set('search', term); docParams.set('scope', 'full'); }
        docParams.set('limit', '8');
        const [docRes, kbRes] = await Promise.all([
          fetch(`/api/documents?${docParams.toString()}`, { credentials: 'same-origin' }),
          fetch('/api/knowledge', { credentials: 'same-origin' }),
        ]);
        const docData = await docRes.json().catch(() => []);
        const documents = Array.isArray(docData) ? docData : (docData.documents || []);
        const kbData = await kbRes.json().catch(() => ({}));
        let knowledge = kbData.knowledgeBases || [];
        if (term) {
          const lower = term.toLowerCase();
          knowledge = knowledge.filter((kb) => `${kb.name || ''} ${kb.description || ''}`.toLowerCase().includes(lower));
        }
        setResults({ documents: documents.slice(0, 8), knowledge: knowledge.slice(0, 6) });
      } catch {
        setResults({ documents: [], knowledge: [] });
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [search, open]);

  const addDoc = useCallback((doc) => {
    onAdd({ contextType: 'document', documentId: doc.id });
    setOpen(false); setSearch('');
  }, [onAdd]);
  const addKb = useCallback((kb) => {
    onAdd({ contextType: 'knowledge_base', knowledgeBaseId: kb.id });
    setOpen(false); setSearch('');
  }, [onAdd]);

  const handleFile = useCallback((e) => {
    const file = e.target.files?.[0];
    if (file && onUpload) onUpload(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setOpen(false);
  }, [onUpload]);

  const visibleDocs = results.documents.filter((d) => !attachedDocumentIds.has(d.id));
  const visibleKbs = results.knowledge.filter((k) => !attachedKnowledgeIds.has(k.id));
  const empty = !searching && visibleDocs.length === 0 && visibleKbs.length === 0;

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-label={t('attachSource')}
        title={t('attachSource')}
        className="shrink-0 w-10 h-10 rounded-xl border border-subtle text-secondary hover:text-accent hover:border-accent/40 flex items-center justify-center disabled:opacity-40 transition-colors"
      >
        <Paperclip className="w-4 h-4" />
      </button>

      {open && (
        <div className="absolute z-30 bottom-12 left-0 w-80 bg-surface-elevated border border-subtle rounded-xl shadow-lg p-2">
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-surface border border-subtle mb-1">
            <Search className="w-3.5 h-3.5 text-secondary shrink-0" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('searchSourcesPlaceholder')}
              className="flex-1 bg-transparent text-xs text-primary outline-none placeholder:text-secondary"
            />
          </div>

          {onUpload && (
            <>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-xs text-accent hover:bg-subtle transition-colors mb-1"
              >
                <Upload className="w-3.5 h-3.5 shrink-0" />
                <span>{t('uploadFromComputer')}</span>
              </button>
              <input ref={fileInputRef} type="file" hidden onChange={handleFile} accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md" />
            </>
          )}

          <div className="max-h-64 overflow-y-auto custom-scrollbar">
            {!search.trim() && !empty && (
              <p className="px-2 pt-1 pb-0.5 text-[10px] uppercase tracking-wider text-secondary/70">{t('recentSources')}</p>
            )}
            {searching ? (
              <p className="px-2 py-2 text-[11px] text-secondary">{t('contextSearching')}</p>
            ) : empty ? (
              <p className="px-2 py-2 text-[11px] text-secondary">{t('contextNoResults')}</p>
            ) : (
              <>
                {visibleKbs.length > 0 && (
                  <>
                    <p className="px-2 pt-1 text-[10px] uppercase tracking-wider text-secondary/70">{t('groupKnowledge')}</p>
                    {visibleKbs.map((kb) => (
                      <button
                        key={`kb-${kb.id}`}
                        type="button"
                        onClick={() => addKb(kb)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-xs text-primary hover:bg-subtle transition-colors"
                      >
                        <BookOpen className="w-3 h-3 text-secondary shrink-0" />
                        <span className="truncate" title={kb.name}>{kb.name}</span>
                      </button>
                    ))}
                  </>
                )}
                {visibleDocs.length > 0 && (
                  <>
                    <p className="px-2 pt-1 text-[10px] uppercase tracking-wider text-secondary/70">{t('groupDocuments')}</p>
                    {visibleDocs.map((doc) => (
                      <button
                        key={`doc-${doc.id}`}
                        type="button"
                        onClick={() => addDoc(doc)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-xs text-primary hover:bg-subtle transition-colors"
                      >
                        <FileText className="w-3 h-3 text-secondary shrink-0" />
                        <span className="truncate" title={doc.title || doc.name}>{doc.title || doc.name}</span>
                      </button>
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
