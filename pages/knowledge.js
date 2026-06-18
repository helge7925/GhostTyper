import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Library, Plus, Trash2, X, Search, FileText, ArrowRight, Users } from 'lucide-react';
import LoadingSpinner from '../components/LoadingSpinner';
import { useTranslations } from '../lib/i18n';
import { usePermission } from '../lib/use-permission';

const RETRIEVAL_MODES = ['focused', 'full_context', 'off'];

async function fetchJson(url, options = {}) {
  const res = await fetch(url, { credentials: 'same-origin', ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
}

function DocumentPicker({ excludeIds, onPick, t }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const boxRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
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
        const params = new URLSearchParams();
        if (term) { params.set('search', term); params.set('scope', 'full'); }
        params.set('limit', '10');
        // Show all of the user's documents; private ones are promoted to
        // workspace visibility on add (see lib/knowledge.js addKnowledgeItem).
        const res = await fetch(`/api/documents?${params.toString()}`, { credentials: 'same-origin' });
        const data = await res.json().catch(() => []);
        setResults(Array.isArray(data) ? data : (data.documents || []));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [search, open]);

  const visible = results.filter((d) => !excludeIds.has(d.id));

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
      >
        <Plus className="w-4 h-4" />
        {t('addDocument')}
      </button>
      {open && (
        <div className="absolute z-20 mt-1 right-0 w-80 bg-surface-elevated border border-subtle rounded-xl shadow-lg p-2">
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-surface border border-subtle mb-1">
            <Search className="w-3.5 h-3.5 text-secondary shrink-0" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="flex-1 bg-transparent text-xs text-primary outline-none placeholder:text-secondary"
            />
          </div>
          <div className="max-h-60 overflow-y-auto custom-scrollbar">
            {searching ? (
              <p className="px-2 py-2 text-[11px] text-secondary">{t('searching')}</p>
            ) : visible.length === 0 ? (
              <p className="px-2 py-2 text-[11px] text-secondary">{t('noResults')}</p>
            ) : (
              visible.map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => { onPick(doc.id); setOpen(false); setSearch(''); setResults([]); }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-xs text-primary hover:bg-subtle transition-colors"
                >
                  <FileText className="w-3 h-3 text-secondary shrink-0" />
                  <span className="truncate flex-1" title={doc.title}>{doc.title}</span>
                  {doc.visibility !== 'workspace' && (
                    <span className="shrink-0 text-[9px] uppercase tracking-wide text-secondary/70 border border-subtle rounded px-1 py-px">{t('privateBadge')}</span>
                  )}
                </button>
              ))
            )}
          </div>
          <p className="px-2 pt-1.5 mt-1 border-t border-subtle text-[10px] text-secondary/80 italic">{t('addShareHint')}</p>
        </div>
      )}
    </div>
  );
}

export default function KnowledgePage() {
  const router = useRouter();
  const { status } = useSession();
  const t = useTranslations('knowledgePage');
  const tNav = useTranslations('nav');
  const canWrite = usePermission('knowledge.write');
  const canDelete = usePermission('knowledge.delete');

  const [bases, setBases] = useState([]);
  const [basesLoading, setBasesLoading] = useState(true);
  const [activeId, setActiveId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login?next=/knowledge');
  }, [status, router]);

  const loadBases = useCallback(async () => {
    try {
      const data = await fetchJson('/api/knowledge');
      setBases(data.knowledgeBases || []);
    } catch {
      setBases([]);
    } finally {
      setBasesLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id) => {
    setDetailLoading(true);
    setError('');
    try {
      const data = await fetchJson(`/api/knowledge/${id}`);
      setDetail(data);
    } catch (err) {
      setError(err.message || t('loadError'));
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, [t]);

  useEffect(() => { if (status === 'authenticated') loadBases(); }, [status, loadBases]);

  const handleSelect = (id) => { setActiveId(id); loadDetail(id); };

  const handleCreate = async (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const data = await fetchJson('/api/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, description: description.trim() || null }),
      });
      setBases((prev) => [{ ...data.knowledgeBase, item_count: 0 }, ...prev]);
      setCreating(false);
      setName('');
      setDescription('');
      handleSelect(data.knowledgeBase.id);
    } catch (err) {
      setError(err.message || t('saveError'));
    }
  };

  const handleDeleteBase = async (id) => {
    if (typeof window !== 'undefined' && !window.confirm(t('confirmDeleteBase'))) return;
    try {
      await fetchJson(`/api/knowledge/${id}`, { method: 'DELETE' });
      setBases((prev) => prev.filter((b) => b.id !== id));
      if (activeId === id) { setActiveId(null); setDetail(null); }
    } catch (err) {
      setError(err.message || t('saveError'));
    }
  };

  const refreshItems = (items) => {
    setDetail((prev) => (prev ? { ...prev, items } : prev));
    setBases((prev) => prev.map((b) => (b.id === activeId ? { ...b, item_count: items.length } : b)));
  };

  const handleAddItem = async (documentId) => {
    try {
      const data = await fetchJson(`/api/knowledge/${activeId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId }),
      });
      refreshItems(data.items || []);
    } catch (err) {
      setError(err.message || t('saveError'));
    }
  };

  const handleRemoveItem = async (itemId) => {
    try {
      const data = await fetchJson(`/api/knowledge/${activeId}/items?itemId=${itemId}`, { method: 'DELETE' });
      refreshItems(data.items || []);
    } catch (err) {
      setError(err.message || t('saveError'));
    }
  };

  const handleChangeMode = async (itemId, retrievalMode) => {
    try {
      const data = await fetchJson(`/api/knowledge/${activeId}/items`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, retrievalMode }),
      });
      refreshItems(data.items || []);
    } catch (err) {
      setError(err.message || t('saveError'));
    }
  };

  if (status === 'loading' || status === 'unauthenticated') return <LoadingSpinner />;

  const items = detail?.items || [];
  const excludeIds = new Set(items.map((it) => it.document_id));

  return (
    <>
      <Head><title>{`${t('title')} – GhostTyper`}</title></Head>
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-1">
          <Library className="w-6 h-6 text-accent" />
          <h1 className="text-xl font-bold text-primary">{t('heading')}</h1>
        </div>
        <p className="text-sm text-secondary mb-5">{t('hint')}</p>

        {error && <div className="mb-4 px-3 py-2 rounded-lg bg-danger/10 border border-danger/20 text-danger text-xs">{error}</div>}

        <div className="flex flex-col md:flex-row gap-5">
          {/* Bases list */}
          <aside className="md:w-72 shrink-0 space-y-2">
            {canWrite && (
              creating ? (
                <form onSubmit={handleCreate} className="p-3 rounded-xl border border-subtle bg-surface-elevated space-y-2">
                  <input
                    autoFocus value={name} onChange={(e) => setName(e.target.value)}
                    placeholder={t('namePlaceholder')}
                    className="w-full bg-surface border border-subtle rounded-lg px-3 py-2 text-sm text-primary outline-none focus:border-accent"
                  />
                  <input
                    value={description} onChange={(e) => setDescription(e.target.value)}
                    placeholder={t('descPlaceholder')}
                    className="w-full bg-surface border border-subtle rounded-lg px-3 py-2 text-xs text-primary outline-none focus:border-accent"
                  />
                  <div className="flex gap-2">
                    <button type="submit" disabled={!name.trim()} className="flex-1 px-3 py-1.5 rounded-lg text-sm font-medium gradient-accent text-white disabled:opacity-40">{t('create')}</button>
                    <button type="button" onClick={() => { setCreating(false); setName(''); setDescription(''); }} className="px-3 py-1.5 rounded-lg text-sm text-secondary hover:text-primary">{t('cancel')}</button>
                  </div>
                </form>
              ) : (
                <button onClick={() => setCreating(true)} className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold gradient-accent text-white shadow-lg shadow-accent/20 transition-all hover:scale-[1.01]">
                  <Plus className="w-4 h-4" /> {t('newBase')}
                </button>
              )
            )}

            {basesLoading ? (
              <div className="py-8 flex justify-center"><LoadingSpinner size="sm" /></div>
            ) : bases.length === 0 ? (
              <p className="text-xs text-secondary px-1 py-4">{t('emptyBases')}</p>
            ) : (
              bases.map((b) => (
                <button
                  key={b.id}
                  onClick={() => handleSelect(b.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-xl border transition-colors ${activeId === b.id ? 'bg-accent/10 border-accent/30 text-accent' : 'border-subtle text-primary hover:bg-hover-subtle'}`}
                >
                  <div className="flex items-center gap-2">
                    <Library className="w-4 h-4 shrink-0 opacity-70" />
                    <span className="truncate font-medium text-sm">{b.name}</span>
                  </div>
                  <span className="text-[11px] text-secondary">{t('itemsCount', { count: b.item_count || 0 })}</span>
                </button>
              ))
            )}
          </aside>

          {/* Detail */}
          <section className="flex-1 min-w-0">
            {!activeId ? (
              <div className="flex flex-col items-center justify-center text-center py-16 text-secondary">
                <Library className="w-10 h-10 mb-3 opacity-30" />
                <p className="text-sm">{t('selectBase')}</p>
              </div>
            ) : detailLoading ? (
              <div className="py-12 flex justify-center"><LoadingSpinner size="sm" /></div>
            ) : detail ? (
              <div className="rounded-xl border border-subtle bg-surface-elevated">
                <div className="flex items-center justify-between gap-3 p-4 border-b border-subtle">
                  <div className="min-w-0">
                    <h2 className="text-base font-bold text-primary truncate">{detail.knowledgeBase.name}</h2>
                    {detail.knowledgeBase.description && <p className="text-xs text-secondary truncate">{detail.knowledgeBase.description}</p>}
                    <span className="inline-flex items-center gap-1 mt-1 text-[10px] text-secondary/80" title={t('sharedInWorkspace')}>
                      <Users className="w-3 h-3" /> {t('sharedInWorkspace')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {canWrite && <DocumentPicker excludeIds={excludeIds} onPick={handleAddItem} t={t} />}
                    {canDelete && (
                      <button onClick={() => handleDeleteBase(detail.knowledgeBase.id)} title={t('deleteBase')} className="p-2 rounded-lg text-secondary hover:text-danger hover:bg-danger/10 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {items.length === 0 ? (
                  <p className="text-xs text-secondary p-6 text-center">{t('noItems')}</p>
                ) : (
                  <ul className="divide-y divide-subtle">
                    {items.map((item) => (
                      <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                        <FileText className="w-4 h-4 text-secondary shrink-0" />
                        <div className="min-w-0 flex-1">
                          {item.transcription_id ? (
                            <Link href={`/transcriptions/${item.transcription_id}`} className="text-sm text-primary hover:text-accent truncate block" title={item.title}>{item.title}</Link>
                          ) : (
                            <span className="text-sm text-primary truncate block" title={item.title}>{item.title}</span>
                          )}
                        </div>
                        <select
                          value={item.retrieval_mode}
                          onChange={(e) => handleChangeMode(item.id, e.target.value)}
                          disabled={!canWrite}
                          aria-label={t('retrievalMode')}
                          className="shrink-0 bg-surface border border-subtle rounded-lg px-2 py-1 text-xs text-primary outline-none focus:border-accent disabled:opacity-60"
                        >
                          {RETRIEVAL_MODES.map((m) => (
                            <option key={m} value={m}>
                              {m === 'focused' ? t('modeFocused') : m === 'full_context' ? t('modeFullContext') : t('modeOff')}
                            </option>
                          ))}
                        </select>
                        {canWrite && (
                          <button onClick={() => handleRemoveItem(item.id)} title={t('removeItem')} className="shrink-0 p-1.5 rounded-lg text-secondary hover:text-danger hover:bg-danger/10 transition-colors">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </section>
        </div>

        <div className="mt-6">
          <Link href="/transcriptions" className="inline-flex items-center gap-1 text-xs text-secondary hover:text-accent">
            {tNav('files')} <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </div>
    </>
  );
}
