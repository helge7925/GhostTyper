import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import TranscriptionCard from '../components/TranscriptionCard';
import LoadingSpinner from '../components/LoadingSpinner';
import Toast from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';
import MeetingStartForm from '../components/MeetingStartForm';
import { Skeleton } from '../components/ui/skeleton';
import { Library, Video, Folder, Tag } from 'lucide-react';
import { getDocuments, getFolders, createFolder, updateFolder, deleteFolder, updateDocument, deleteDocument, reindexDocument, bulkDocuments } from '../lib/api';
import { useTranslations } from '../lib/i18n';
import { useUiFeedback } from '../lib/use-ui-feedback';
import { usePermission } from '../lib/use-permission';
import { useVexaIntegrationEnabled } from '../lib/use-vexa-integration';

const PAGE_SIZE = 100;
const SEARCH_LIMIT = 200;

function ListSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="bg-surface border border-subtle rounded-xl p-4 flex items-center gap-3"
        >
          <Skeleton className="w-10 h-10 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-2.5 w-1/3" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export default function Transcriptions() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const tNav = useTranslations('nav');
  const tList = useTranslations('transcriptions');
  const tSidebar = useTranslations('transcriptionsList');
  const tMeeting = useTranslations('meeting.start');
  const canStartMeeting = usePermission('meeting.start');
  const {
    enabled: vexaEnabled,
    defaultBotName: vexaDefaultBotName,
    defaultLanguage: vexaDefaultLanguage,
    gdprChatNoticeDefault,
  } = useVexaIntegrationEnabled();
  const showMeetingButton = canStartMeeting && vexaEnabled;
  const [meetingDialogOpen, setMeetingDialogOpen] = useState(false);

  // Sidebar deeplink: /transcriptions?meeting=1 opens the start dialog directly.
  useEffect(() => {
    if (!router.isReady) return;
    if (router.query.meeting && showMeetingButton) {
      setMeetingDialogOpen(true);
      const { meeting, ...rest } = router.query;
      router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true });
    }
  }, [router.isReady, router.query.meeting, showMeetingButton]); // eslint-disable-line react-hooks/exhaustive-deps
  const [transcriptions, setTranscriptions] = useState([]);
  const [folders, setFolders] = useState([]);
  const [activeFolderId, setActiveFolderId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [editingFolderId, setEditingFolderId] = useState(null);
  const [editFolderName, setEditFolderName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [visibilityFilter, setVisibilityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [viewMode, setViewMode] = useState('list');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [reindexingIds, setReindexingIds] = useState(() => new Set());
  const searchTimeoutRef = useRef(null);
  const canReindexDocuments = usePermission('document.write');
  const canAddToKnowledge = usePermission('knowledge.write');
  const canReadKnowledge = usePermission('knowledge.read');
  const {
    toast,
    showToast,
    clearToast,
    confirmDialog,
    confirm,
    closeConfirm,
    acceptConfirm,
  } = useUiFeedback();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
      return;
    }
    if (status !== 'authenticated') return;

    Promise.all([
      getDocuments('', { limit: PAGE_SIZE, offset: 0 }),
      getFolders(),
    ])
      .then(([transcripts, foldersData]) => {
        setTranscriptions(transcripts);
        setHasMore(transcripts.length >= PAGE_SIZE);
        setFolders(foldersData);
      })
      .catch(() => {
        setTranscriptions([]);
        setHasMore(false);
        setFolders([]);
      })
      .finally(() => setLoading(false));
  }, [status, router]);

  const handleLoadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const next = await getDocuments('', {
        limit: PAGE_SIZE,
        offset: transcriptions.length,
      });
      setTranscriptions((prev) => {
        const seen = new Set(prev.map((t) => t.id));
        return [...prev, ...next.filter((t) => !seen.has(t.id))];
      });
      setHasMore(next.length >= PAGE_SIZE);
    } catch {
      // Network errors are surfaced via toast in other actions; here we
      // simply stop trying to avoid an infinite spinner.
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, transcriptions.length]);

  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    const query = searchQuery.trim();
    const baseOptions = {
      limit: query ? SEARCH_LIMIT : PAGE_SIZE,
      offset: 0,
      ...(sourceFilter ? { sourceType: sourceFilter } : {}),
      ...(visibilityFilter ? { visibility: visibilityFilter } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(favoriteOnly ? { favorite: 'true' } : {}),
    };
    if (query === '') {
      setSearching(true);
      getDocuments('', baseOptions)
        .then((results) => {
          setTranscriptions(results);
          setHasMore(results.length >= PAGE_SIZE);
        })
        .catch(() => {})
        .finally(() => setSearching(false));
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await getDocuments(query, {
          ...baseOptions,
          scope: 'full',
        });
        setTranscriptions(results);
        setHasMore(false); // search returns top-N matches; no incremental loading
      } catch {
        // ignore
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, sourceFilter, visibilityFilter, statusFilter, favoriteOnly]);

  const handleCreateFolder = useCallback(async (e) => {
    if (e) e.preventDefault();
    if (!newFolderName.trim()) return;
    try {
      const folder = await createFolder(newFolderName);
      setFolders(prev => [...prev, folder]);
      setNewFolderName('');
      setIsCreatingFolder(false);
    } catch (err) {
      showToast('Ordner konnte nicht erstellt werden', 'error');
    }
  }, [newFolderName, showToast]);

  const handleRenameFolder = useCallback(async (id) => {
    if (!editFolderName.trim()) return;
    try {
      const updated = await updateFolder(id, editFolderName);
      setFolders(prev => prev.map(f => f.id === id ? updated : f));
      setEditingFolderId(null);
    } catch (err) {
      showToast('Ordner konnte nicht umbenannt werden', 'error');
    }
  }, [editFolderName, showToast]);

  const handleDeleteFolder = useCallback(async (id) => {
    const approved = await confirm({
      title: 'Ordner löschen',
      message: 'Ordner wirklich löschen? Die Dateien darin werden in die Hauptliste verschoben.',
      confirmLabel: 'Ordner löschen',
      danger: true,
    });
    if (!approved) return;
    try {
      await deleteFolder(id);
      setFolders(prev => prev.filter(f => String(f.id) !== String(id)));
      setTranscriptions(prev => prev.map(t => String(t.folder_id || '') === String(id) ? { ...t, folder_id: null } : t));
      if (String(activeFolderId) === String(id)) setActiveFolderId(null);
    } catch (err) {
      showToast('Ordner konnte nicht gelöscht werden', 'error');
    }
  }, [activeFolderId, confirm, showToast]);

  const handleMoveToFolder = useCallback(async (transcriptionId, folderId) => {
    try {
      await updateDocument(transcriptionId, { folderId });
      setTranscriptions(prev => prev.map(t => t.id === transcriptionId ? { ...t, folder_id: folderId } : t));
    } catch (err) {
      showToast('Datei konnte nicht verschoben werden', 'error');
    }
  }, [showToast]);

  const handleToggleFavorite = useCallback(async (transcriptionId, currentStatus) => {
    try {
      await updateDocument(transcriptionId, { isFavorite: !currentStatus });
      setTranscriptions(prev => prev.map(t => t.id === transcriptionId ? { ...t, is_favorite: !currentStatus } : t));
    } catch (err) {
      showToast('Favoriten-Status konnte nicht geändert werden', 'error');
    }
  }, [showToast]);

  const handleDeleteTranscription = useCallback(async (id) => {
    const approved = await confirm({
      title: 'Datei löschen',
      message: 'Datei unwiderruflich löschen?',
      confirmLabel: 'Datei löschen',
      danger: true,
    });
    if (!approved) return;
    try {
      await deleteDocument(id);
      setTranscriptions(prev => prev.filter(t => t.id !== id));
    } catch (err) {
      showToast('Fehler beim Löschen: ' + (err.message || 'Unbekannter Fehler'), 'error');
    }
  }, [confirm, showToast]);

  const handleEditTags = useCallback(async (entry) => {
    const current = Array.isArray(entry.tags) ? entry.tags.join(', ') : '';
    const next = window.prompt('Tags kommagetrennt bearbeiten', current);
    if (next === null) return;
    const tags = next.split(',').map((tag) => tag.trim()).filter(Boolean);
    try {
      const updated = await updateDocument(entry.id, { tags });
      setTranscriptions((prev) => prev.map((item) => (item.id === entry.id ? { ...item, tags: updated.tags || tags } : item)));
    } catch (err) {
      showToast('Tags konnten nicht gespeichert werden', 'error');
    }
  }, [showToast]);

  const toggleSelected = useCallback((id, checked) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const [bulkActionDialog, setBulkActionDialog] = useState(null); // { type: 'move' | 'tag', data?: any }
  const [bulkTagInput, setBulkTagInput] = useState('');
  const [bulkTagMode, setBulkTagMode] = useState('replace'); // 'replace' | 'add' | 'remove'
  const [bulkFolderId, setBulkFolderId] = useState(null);

  const handleBulkDelete = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const approved = await confirm({
      title: 'Dateien löschen',
      message: `${ids.length} Dateien unwiderruflich löschen?`,
      confirmLabel: 'Dateien löschen',
      danger: true,
    });
    if (!approved) return;
    try {
      const result = await bulkDocuments('delete', ids);
      setTranscriptions((prev) => prev.filter((entry) => !result.success.includes(entry.id)));
      setSelectedIds(new Set());
      if (result.failed.length > 0) {
        showToast(`${result.failed.length} Dateien konnten nicht gelöscht werden`, 'error');
      } else {
        showToast(`${result.success.length} Dateien gelöscht`, 'success');
      }
    } catch (err) {
      showToast('Fehler beim Löschen der Dateien', 'error');
    }
  }, [confirm, selectedIds, showToast]);

  const handleBulkMove = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkActionDialog({ type: 'move' });
  }, [selectedIds]);

  const handleBulkTag = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkActionDialog({ type: 'tag' });
    setBulkTagInput('');
    setBulkTagMode('replace');
  }, [selectedIds]);

  const confirmBulkMove = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0 || bulkFolderId === undefined) return;
    setBulkActionDialog(null);
    try {
      const result = await bulkDocuments('move', ids, { folderId: bulkFolderId });
      // Refresh the list to show updated folder assignments
      await loadDocuments();
      setSelectedIds(new Set());
      if (result.failed.length > 0) {
        showToast(`${result.failed.length} Dateien konnten nicht verschoben werden`, 'error');
      } else {
        showToast(`${result.success.length} Dateien verschoben`, 'success');
      }
    } catch (err) {
      showToast('Fehler beim Verschieben der Dateien', 'error');
    }
  }, [selectedIds, bulkFolderId, showToast, loadDocuments]);

  const confirmBulkTag = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkActionDialog(null);
    const tags = bulkTagInput.split(',').map((tag) => tag.trim()).filter(Boolean);
    try {
      const result = await bulkDocuments('tag', ids, { tags, tagMode: bulkTagMode });
      // Refresh the list to show updated tags
      await loadDocuments();
      setSelectedIds(new Set());
      if (result.failed.length > 0) {
        showToast(`${result.failed.length} Dateien konnten nicht getaggt werden`, 'error');
      } else {
        showToast(`${result.success.length} Dateien getaggt`, 'success');
      }
    } catch (err) {
      showToast('Fehler beim Taggen der Dateien', 'error');
    }
  }, [selectedIds, bulkTagInput, bulkTagMode, showToast, loadDocuments]);

  const cancelBulkAction = useCallback(() => {
    setBulkActionDialog(null);
    setBulkTagInput('');
    setBulkFolderId(null);
  }, []);

  const handleReindexDocument = useCallback(async (id) => {
    setReindexingIds((prev) => new Set(prev).add(id));
    setTranscriptions((prev) => prev.map((entry) => entry.id === id
      ? { ...entry, index_job_status: 'processing', index_job_error: null }
      : entry));
    try {
      const result = await reindexDocument(id);
      setTranscriptions((prev) => prev.map((entry) => entry.id === id
        ? {
            ...entry,
            chunk_count: result.chunks,
            index_job_status: 'completed',
            index_job_error: null,
          }
        : entry));
      showToast(`Index erstellt: ${result.chunks || 0} Chunks, ${result.embeddings || 0} Embeddings`, 'success');
    } catch (err) {
      setTranscriptions((prev) => prev.map((entry) => entry.id === id
        ? { ...entry, index_job_status: 'error', index_job_error: err.message || 'Indexierung fehlgeschlagen' }
        : entry));
      showToast('Index konnte nicht erstellt werden: ' + (err.message || 'Unbekannter Fehler'), 'error');
    } finally {
      setReindexingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, [showToast]);

  const filteredTranscriptions = useMemo(() => {
    return transcriptions.filter(t => {
      return activeFolderId === null || String(t.folder_id || '') === String(activeFolderId);
    });
  }, [transcriptions, activeFolderId]);
  const folderCounts = useMemo(() => {
    return transcriptions.reduce((counts, entry) => {
      if (!entry.folder_id) return counts;
      const key = String(entry.folder_id);
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {});
  }, [transcriptions]);

  if (status === 'loading' || (status === 'unauthenticated')) return <LoadingSpinner />;

  return (
    <>
      <Head>
        <title>{`${tNav('history')} – GhostTyper`}</title>
      </Head>

      <div className="w-full flex flex-col md:flex-row gap-8 min-h-[60vh]">
        {/* Sidebar: Folders */}
        <aside className="w-full md:w-64 shrink-0">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[10px] font-bold text-secondary uppercase tracking-[0.2em]">{tSidebar('folders')}</h2>
            <button
              onClick={() => setIsCreatingFolder(true)}
              className="p-1 hover:bg-hover-subtle rounded text-accent transition-colors"
              title={tSidebar('newFolder')}
              aria-label={tSidebar('newFolderTooltip')}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            </button>
          </div>

          <div className="space-y-1">
            <button
              onClick={() => setActiveFolderId(null)}
              className={`w-full text-left px-3 py-2 rounded-xl text-sm transition-all flex items-center justify-between gap-3 ${activeFolderId === null ? 'bg-accent text-white shadow-lg shadow-accent/20' : 'text-secondary hover:bg-hover-subtle'}`}
            >
              <span className="flex items-center gap-3 min-w-0">
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
                <span className="truncate">{tSidebar('allFiles')}</span>
              </span>
              <span className="text-[10px] opacity-70">{transcriptions.length}</span>
            </button>

            {isCreatingFolder && (
              <form onSubmit={handleCreateFolder} className="px-3 py-2">
                <input
                  autoFocus
                  type="text"
                  value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  onBlur={() => !newFolderName && setIsCreatingFolder(false)}
                  placeholder={tSidebar('folderNamePlaceholder')}
                  className="w-full bg-surface-elevated border border-accent/50 rounded-lg px-2 py-1 text-xs text-primary outline-none"
                />
              </form>
            )}

            {folders.map(folder => (
              <div key={folder.id} className="group relative">
                {editingFolderId === folder.id ? (
                  <div className="px-3 py-2">
                    <input
                      autoFocus
                      type="text"
                      value={editFolderName}
                      onChange={e => setEditFolderName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleRenameFolder(folder.id)}
                      onBlur={() => setEditingFolderId(null)}
                      className="w-full bg-surface-elevated border border-accent/50 rounded-lg px-2 py-1 text-xs text-primary outline-none"
                    />
                  </div>
                ) : (
                  <div className="flex items-center">
                    <button
                      onClick={() => setActiveFolderId(folder.id)}
                      className={`flex-1 text-left px-3 py-2 pr-16 rounded-xl text-sm transition-all flex items-center justify-between gap-3 min-w-0 ${String(activeFolderId) === String(folder.id) ? 'bg-accent/20 text-accent border border-accent/20' : 'text-secondary hover:bg-hover-subtle'}`}
                    >
                      <span className="flex items-center gap-3 min-w-0">
                        <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
                        <span className="truncate">{folder.name}</span>
                      </span>
                      <span className="text-[10px] opacity-70">{folderCounts[String(folder.id)] || 0}</span>
                    </button>
                    
                    <div className="absolute right-2 flex gap-1 transition-opacity opacity-100 md:opacity-0 md:group-hover:opacity-100">
                      <button 
                        onClick={() => { setEditingFolderId(folder.id); setEditFolderName(folder.name); }}
                        className="p-1 text-secondary hover:text-white"
                        aria-label={tSidebar('renameFolderAria', { name: folder.name })}
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                      </button>
                      <button 
                        onClick={() => handleDeleteFolder(folder.id)}
                        className="p-1 text-secondary hover:text-danger"
                        aria-label={tSidebar('deleteFolderAria', { name: folder.name })}
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </aside>

        {/* Main: Transcription List */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-col gap-4 mb-6 xl:flex-row xl:items-center xl:justify-between">
            <h1 className="text-2xl font-semibold text-primary truncate min-w-0 shrink-0">
              {activeFolderId === null ? 'Alle Dateien' : folders.find(f => f.id === activeFolderId)?.name}
            </h1>

            <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto min-w-0">
              <div className="relative flex-1 xl:flex-initial min-w-0">
                {searching ? (
                  <div className="w-4 h-4 border-2 border-emphasis border-t-accent rounded-full animate-spin absolute left-3 top-1/2 -translate-y-1/2" />
                ) : (
                  <svg className="w-4 h-4 text-secondary absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                )}
                <label htmlFor="transcription-search" className="sr-only">Dateien durchsuchen</label>
                <input 
                  id="transcription-search"
                  type="text" 
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Dateien durchsuchen..." 
                  className="bg-surface-elevated border border-subtle rounded-xl pl-9 pr-4 py-2 text-xs text-primary outline-none focus:ring-1 focus:ring-accent w-full xl:w-64"
                />
              </div>
              {showMeetingButton && (
                <button
                  type="button"
                  onClick={() => setMeetingDialogOpen(true)}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 transition-colors whitespace-nowrap"
                >
                  <Video className="w-4 h-4" />
                  <span>{tMeeting('buttonLabel')}</span>
                </button>
              )}
              {canReadKnowledge && (
                <Link
                  href="/knowledge"
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium border border-subtle text-secondary hover:text-primary hover:border-accent/40 transition-colors whitespace-nowrap"
                >
                  <Library className="w-4 h-4" />
                  <span>Workspace Wissen</span>
                </Link>
              )}
              <div className="text-[10px] text-secondary uppercase tracking-widest font-bold whitespace-nowrap hidden xl:block">
                {filteredTranscriptions.length} {filteredTranscriptions.length === 1 ? 'Eintrag' : 'Einträge'}
              </div>
            </div>
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className="bg-surface-elevated border border-subtle rounded-lg px-2 py-1.5 text-xs text-primary">
              <option value="">Alle Typen</option>
              <option value="audio_transcription">Transkription</option>
              <option value="meeting">Meeting</option>
              <option value="ocr">OCR</option>
              <option value="translation">Übersetzung</option>
              <option value="data_table">Datentabelle</option>
              <option value="text">Text</option>
            </select>
            <select value={visibilityFilter} onChange={(e) => setVisibilityFilter(e.target.value)} className="bg-surface-elevated border border-subtle rounded-lg px-2 py-1.5 text-xs text-primary">
              <option value="">Alle Sichtbarkeiten</option>
              <option value="workspace">Workspace</option>
              <option value="private">Privat</option>
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="bg-surface-elevated border border-subtle rounded-lg px-2 py-1.5 text-xs text-primary">
              <option value="">Alle Status</option>
              <option value="ready">Bereit</option>
              <option value="completed">Abgeschlossen</option>
              <option value="transcribed">Transkribiert</option>
              <option value="processing">Verarbeitung</option>
              <option value="error">Fehler</option>
            </select>
            <button type="button" onClick={() => setFavoriteOnly((value) => !value)} className={`px-3 py-1.5 rounded-lg text-xs border ${favoriteOnly ? 'bg-accent text-white border-accent' : 'border-subtle text-secondary hover:text-primary'}`}>
              Favoriten
            </button>
            <button type="button" onClick={() => setViewMode((value) => value === 'list' ? 'grid' : 'list')} className="px-3 py-1.5 rounded-lg text-xs border border-subtle text-secondary hover:text-primary">
              {viewMode === 'list' ? 'Grid' : 'Liste'}
            </button>
            {selectedIds.size > 0 && (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={handleBulkDelete} className="px-3 py-1.5 rounded-lg text-xs bg-danger/10 text-danger border border-danger/30">
                  {selectedIds.size} löschen
                </button>
                <button type="button" onClick={handleBulkMove} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-accent/10 text-accent border border-accent/30">
                  <Folder className="w-3.5 h-3.5" />
                  Verschieben
                </button>
                <button type="button" onClick={handleBulkTag} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-accent/10 text-accent border border-accent/30">
                  <Tag className="w-3.5 h-3.5" />
                  Tags
                </button>
              </div>
            )}
          </div>

          {loading ? (
            <ListSkeleton />
          ) : filteredTranscriptions.length === 0 ? (
            <div className="bg-surface border border-subtle rounded-xl p-12 text-center">
              <div className="w-16 h-16 bg-hover rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <p className="text-primary font-medium mb-1">
                {searchQuery ? tSidebar('emptySearch') : tSidebar('emptyFolder')}
              </p>
              <p className="text-sm text-secondary">
                {searchQuery ? 'Versuchen Sie es mit einem anderen Begriff.' : 'Laden Sie etwas hoch oder verschieben Sie Dateien hierher.'}
              </p>
            </div>
          ) : (
            <div className={viewMode === 'grid' ? 'grid grid-cols-1 xl:grid-cols-2 gap-3' : 'space-y-3'}>
              {filteredTranscriptions.map((t) => (
                <TranscriptionCard
                  key={t.id}
                  transcription={t}
                  folders={folders}
                  onMove={(folderId) => handleMoveToFolder(t.id, folderId)}
                  onToggleFavorite={() => handleToggleFavorite(t.id, t.is_favorite)}
                  onReindex={canReindexDocuments ? () => handleReindexDocument(t.id) : undefined}
                  reindexing={reindexingIds.has(t.id)}
                  onDelete={() => handleDeleteTranscription(t.id)}
                  onEditTags={() => handleEditTags(t)}
                  canAddToKnowledge={canAddToKnowledge}
                  selectable
                  selected={selectedIds.has(t.id)}
                  onSelect={(checked) => toggleSelected(t.id, checked)}
                  viewMode={viewMode}
                />
              ))}

              {hasMore && !searchQuery && (
                <div className="pt-4 flex justify-center">
                  <button
                    type="button"
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="px-5 py-2.5 rounded-xl text-sm font-semibold border border-subtle bg-surface text-primary hover:bg-hover-subtle disabled:opacity-60 transition-colors"
                  >
                    {loadingMore ? 'Lädt…' : 'Weitere laden'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
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
      {bulkActionDialog?.type === 'move' && (
        <ConfirmDialog
          open={true}
          title="Dateien verschieben"
          message={
            <div className="space-y-4">
              <p>{selectedIds.size} Dateien in einen Ordner verschieben.</p>
              <div className="space-y-2">
                <label className="text-xs text-secondary uppercase tracking-widest font-bold">Zielordner</label>
                <select
                  value={bulkFolderId || ''}
                  onChange={(e) => setBulkFolderId(e.target.value === '' ? null : Number(e.target.value))}
                  className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-sm text-primary"
                >
                  <option value="">(Kein Ordner / Root)</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          }
          confirmLabel="Verschieben"
          onConfirm={confirmBulkMove}
          onCancel={cancelBulkAction}
        />
      )}
      {bulkActionDialog?.type === 'tag' && (
        <ConfirmDialog
          open={true}
          title="Dateien taggen"
          message={
            <div className="space-y-4">
              <p>{selectedIds.size} Dateien mit Tags versehen.</p>
              <div className="space-y-2">
                <label className="text-xs text-secondary uppercase tracking-widest font-bold">Tags (kommagetrennt)</label>
                <input
                  type="text"
                  value={bulkTagInput}
                  onChange={(e) => setBulkTagInput(e.target.value)}
                  placeholder="z.B. wichtig, projekt-x"
                  className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-sm text-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-secondary uppercase tracking-widest font-bold">Modus</label>
                <div className="flex gap-2">
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="bulkTagMode"
                      value="replace"
                      checked={bulkTagMode === 'replace'}
                      onChange={() => setBulkTagMode('replace')}
                      className="w-3.5 h-3.5"
                    />
                    <span className="text-xs text-secondary">Ersetzen</span>
                  </label>
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="bulkTagMode"
                      value="add"
                      checked={bulkTagMode === 'add'}
                      onChange={() => setBulkTagMode('add')}
                      className="w-3.5 h-3.5"
                    />
                    <span className="text-xs text-secondary">Hinzufügen</span>
                  </label>
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="bulkTagMode"
                      value="remove"
                      checked={bulkTagMode === 'remove'}
                      onChange={() => setBulkTagMode('remove')}
                      className="w-3.5 h-3.5"
                    />
                    <span className="text-xs text-secondary">Entfernen</span>
                  </label>
                </div>
              </div>
            </div>
          }
          confirmLabel="Taggen"
          onConfirm={confirmBulkTag}
          onCancel={cancelBulkAction}
        />
      )}
      {showMeetingButton && (
        <MeetingStartForm
          open={meetingDialogOpen}
          onOpenChange={setMeetingDialogOpen}
          defaultBotName={vexaDefaultBotName}
          defaultLanguage={vexaDefaultLanguage}
          gdprChatNoticeDefault={gdprChatNoticeDefault}
        />
      )}
    </>
  );
}
