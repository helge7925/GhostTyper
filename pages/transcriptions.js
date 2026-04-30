import Head from 'next/head';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import TranscriptionCard from '../components/TranscriptionCard';
import LoadingSpinner from '../components/LoadingSpinner';
import Toast from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';
import { getTranscriptions, getFolders, createFolder, updateFolder, deleteFolder, updateTranscription, deleteTranscription } from '../lib/api';
import { useUiFeedback } from '../lib/use-ui-feedback';

export default function Transcriptions() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [transcriptions, setTranscriptions] = useState([]);
  const [folders, setFolders] = useState([]);
  const [activeFolderId, setActiveFolderId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [editingFolderId, setEditingFolderId] = useState(null);
  const [editFolderName, setEditFolderName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const searchTimeoutRef = useRef(null);
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

    Promise.all([getTranscriptions('', { limit: 500 }), getFolders()])
      .then(([transcripts, foldersData]) => {
        setTranscriptions(transcripts);
        setFolders(foldersData);
      })
      .catch(() => {
        setTranscriptions([]);
        setFolders([]);
      })
      .finally(() => setLoading(false));
  }, [status, router]);

  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    const query = searchQuery.trim();
    if (query === '') {
      setSearching(true);
      getTranscriptions('', { limit: 500 })
        .then((results) => setTranscriptions(results))
        .catch(() => {})
        .finally(() => setSearching(false));
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await getTranscriptions(query, { scope: 'full', limit: 200, offset: 0 });
        setTranscriptions(results);
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
  }, [searchQuery]);

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
      await updateTranscription(transcriptionId, { folderId });
      setTranscriptions(prev => prev.map(t => t.id === transcriptionId ? { ...t, folder_id: folderId } : t));
    } catch (err) {
      showToast('Datei konnte nicht verschoben werden', 'error');
    }
  }, [showToast]);

  const handleToggleFavorite = useCallback(async (transcriptionId, currentStatus) => {
    try {
      await updateTranscription(transcriptionId, { isFavorite: !currentStatus });
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
      await deleteTranscription(id);
      setTranscriptions(prev => prev.filter(t => t.id !== id));
    } catch (err) {
      showToast('Fehler beim Löschen: ' + (err.message || 'Unbekannter Fehler'), 'error');
    }
  }, [confirm, showToast]);

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
        <title>Historie - GhostTyper</title>
      </Head>

      <div className="w-full flex flex-col md:flex-row gap-8 min-h-[60vh]">
        {/* Sidebar: Folders */}
        <aside className="w-full md:w-64 shrink-0">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[10px] font-bold text-secondary uppercase tracking-[0.2em]">Ordner</h2>
            <button 
              onClick={() => setIsCreatingFolder(true)} 
              className="p-1 hover:bg-hover-subtle rounded text-accent transition-colors"
              title="Neuer Ordner"
              aria-label="Neuen Ordner erstellen"
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
                <span className="truncate">Alle Dateien</span>
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
                  placeholder="Ordnername..."
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
                        aria-label={`Ordner ${folder.name} umbenennen`}
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                      </button>
                      <button 
                        onClick={() => handleDeleteFolder(folder.id)}
                        className="p-1 text-secondary hover:text-danger"
                        aria-label={`Ordner ${folder.name} löschen`}
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
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
            <h1 className="text-2xl font-semibold text-primary truncate min-w-0">
              {activeFolderId === null ? 'Alle Dateien' : folders.find(f => f.id === activeFolderId)?.name}
            </h1>
            
            <div className="flex items-center gap-3 w-full lg:w-auto min-w-0">
              <div className="relative flex-1 lg:flex-initial min-w-0">
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
                  className="bg-surface-elevated border border-subtle rounded-xl pl-9 pr-4 py-2 text-xs text-primary outline-none focus:ring-1 focus:ring-accent w-full lg:w-64"
                />
              </div>
              <div className="text-[10px] text-secondary uppercase tracking-widest font-bold whitespace-nowrap hidden xl:block">
                {filteredTranscriptions.length} {filteredTranscriptions.length === 1 ? 'Eintrag' : 'Einträge'}
              </div>
            </div>
          </div>

          {loading ? (
            <LoadingSpinner />
          ) : filteredTranscriptions.length === 0 ? (
            <div className="bg-surface border border-subtle rounded-xl p-12 text-center">
              <div className="w-16 h-16 bg-hover rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <p className="text-primary font-medium mb-1">
                {searchQuery ? 'Keine Ergebnisse für Ihre Suche' : 'Dieser Ordner ist leer'}
              </p>
              <p className="text-sm text-secondary">
                {searchQuery ? 'Versuchen Sie es mit einem anderen Begriff.' : 'Laden Sie etwas hoch oder verschieben Sie Dateien hierher.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredTranscriptions.map((t) => (
                <TranscriptionCard 
                  key={t.id} 
                  transcription={t} 
                  folders={folders} 
                  onMove={(folderId) => handleMoveToFolder(t.id, folderId)}
                  onToggleFavorite={() => handleToggleFavorite(t.id, t.is_favorite)}
                  onDelete={() => handleDeleteTranscription(t.id)}
                />
              ))}
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
    </>
  );
}
