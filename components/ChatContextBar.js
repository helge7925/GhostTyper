import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, FileText, Plus, X, Search } from 'lucide-react';
import { useTranslations } from '../lib/i18n';

export default function ChatContextBar({ items = [], onAdd, onRemove, disabled = false }) {
  const t = useTranslations('chatPage');
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('document');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const boxRef = useRef(null);
  const debounceRef = useRef(null);

  const attachedDocumentIds = new Set(items.filter((it) => it.context_type !== 'knowledge_base').map((it) => it.document_id));
  const attachedKnowledgeIds = new Set(items.filter((it) => it.context_type === 'knowledge_base').map((it) => it.knowledge_base_id));

  // Close the picker when clicking outside.
  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const term = search.trim();
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        if (mode === 'knowledge_base') {
          const res = await fetch('/api/knowledge', { credentials: 'same-origin' });
          const data = await res.json().catch(() => ({}));
          const bases = data.knowledgeBases || [];
          const filtered = term
            ? bases.filter((kb) => `${kb.name || ''} ${kb.description || ''}`.toLowerCase().includes(term.toLowerCase()))
            : bases;
          setResults(filtered.slice(0, 10));
        } else {
          const params = new URLSearchParams();
          if (term) {
            params.set('search', term);
            params.set('scope', 'full');
          }
          params.set('limit', '10');
          const res = await fetch(`/api/documents?${params.toString()}`, { credentials: 'same-origin' });
          const data = await res.json().catch(() => []);
          setResults(Array.isArray(data) ? data : (data.documents || []));
        }
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [search, open, mode]);

  const handleAdd = useCallback((item) => {
    onAdd(mode === 'knowledge_base'
      ? { contextType: 'knowledge_base', knowledgeBaseId: item.id }
      : { contextType: 'document', documentId: item.id });
    setOpen(false);
    setSearch('');
    setResults([]);
  }, [mode, onAdd]);

  const visibleResults = results.filter((item) => (
    mode === 'knowledge_base' ? !attachedKnowledgeIds.has(item.id) : !attachedDocumentIds.has(item.id)
  ));

  return (
    <div className="px-4 py-2 border-b border-subtle flex flex-wrap items-center gap-1.5 bg-surface">
      <span className="text-[10px] font-medium text-secondary mr-0.5">{t('contextLabel')}</span>

      {items.map((item) => (
        <span key={item.id} className="inline-flex items-center gap-1 max-w-[220px] pl-2 pr-1 py-0.5 rounded-full bg-accent/10 text-accent text-[11px] border border-accent/20">
          {item.context_type === 'knowledge_base' ? <BookOpen className="w-2.5 h-2.5 shrink-0" /> : <FileText className="w-2.5 h-2.5 shrink-0" />}
          <span className="truncate" title={item.title}>{item.title || t('sourceFallback', { index: item.document_id || item.knowledge_base_id })}</span>
          <button
            type="button"
            onClick={() => onRemove(item)}
            disabled={disabled}
            aria-label={t('contextRemove')}
            className="shrink-0 rounded-full p-0.5 hover:bg-accent/20 disabled:opacity-40"
          >
            <X className="w-2.5 h-2.5" />
          </button>
        </span>
      ))}

      <div className="relative" ref={boxRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={disabled}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-dashed border-subtle text-secondary text-[11px] hover:text-accent hover:border-accent/40 disabled:opacity-40 transition-colors"
        >
          <Plus className="w-2.5 h-2.5" />
          {t('contextAttach')}
        </button>

        {open && (
          <div className="absolute z-20 mt-1 left-0 w-72 bg-surface-elevated border border-subtle rounded-xl shadow-lg p-2">
            <div className="grid grid-cols-2 gap-1 mb-2">
              <button
                type="button"
                onClick={() => { setMode('document'); setSearch(''); setResults([]); }}
                className={`px-2 py-1 rounded-lg text-[11px] ${mode === 'document' ? 'bg-accent text-white' : 'bg-surface text-secondary hover:text-primary'}`}
              >
                {t('contextAttachFile')}
              </button>
              <button
                type="button"
                onClick={() => { setMode('knowledge_base'); setSearch(''); setResults([]); }}
                className={`px-2 py-1 rounded-lg text-[11px] ${mode === 'knowledge_base' ? 'bg-accent text-white' : 'bg-surface text-secondary hover:text-primary'}`}
              >
                {t('contextAttachKnowledge')}
              </button>
            </div>
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-surface border border-subtle mb-1">
              <Search className="w-3.5 h-3.5 text-secondary shrink-0" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={mode === 'knowledge_base' ? t('contextSearchKnowledgePlaceholder') : t('contextSearchPlaceholder')}
                className="flex-1 bg-transparent text-xs text-primary outline-none placeholder:text-secondary"
              />
            </div>
            <div className="max-h-56 overflow-y-auto custom-scrollbar">
              {searching ? (
                <p className="px-2 py-2 text-[11px] text-secondary">{t('contextSearching')}</p>
              ) : visibleResults.length === 0 ? (
                <p className="px-2 py-2 text-[11px] text-secondary">{t('contextNoResults')}</p>
              ) : (
                visibleResults.map((doc) => (
                  <button
                    key={doc.id}
                    type="button"
                    onClick={() => handleAdd(doc)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-xs text-primary hover:bg-subtle transition-colors"
                  >
                    {mode === 'knowledge_base' ? <BookOpen className="w-3 h-3 text-secondary shrink-0" /> : <FileText className="w-3 h-3 text-secondary shrink-0" />}
                    <span className="truncate" title={doc.title || doc.name}>{doc.title || doc.name}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
