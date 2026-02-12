import Head from 'next/head';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { useState, useEffect, useMemo, useCallback } from 'react';
import TranscriptionCard from '../components/TranscriptionCard';
import LoadingSpinner from '../components/LoadingSpinner';
import { getTranscriptions, getFolders, createFolder, updateFolder, deleteFolder, updateTranscription, deleteTranscription } from '../lib/api';

export default function Transcriptions() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [transcriptions, setTranscriptions] = useState([]);
  const [folders, setFolders] = useState([]);
  const [activeFolderId, setActiveFolderId] = useState(null); // null means root/all
  const [loading, setLoading] = useState(true);
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [editingFolderId, setEditingFolderId] = useState(null);
  const [editFolderName, setEditFolderName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
      return;
    }
    if (status !== 'authenticated') return;

    Promise.all([getTranscriptions(), getFolders()])
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

  const handleCreateFolder = useCallback(async (e) => {
    if (e) e.preventDefault();
    if (!newFolderName.trim()) return;
    try {
      const folder = await createFolder(newFolderName);
      setFolders(prev => [...prev, folder]);
      setNewFolderName('');
      setIsCreatingFolder(false);
    } catch (err) {
      alert('Ordner konnte nicht erstellt werden');
    }
  }, [newFolderName]);

  const handleRenameFolder = useCallback(async (id) => {
    if (!editFolderName.trim()) return;
    try {
      const updated = await updateFolder(id, editFolderName);
      setFolders(prev => prev.map(f => f.id === id ? updated : f));
      setEditingFolderId(null);
    } catch (err) {
      alert('Ordner konnte nicht umbenannt werden');
    }
  }, [editFolderName]);

  const handleDeleteFolder = useCallback(async (id) => {
    if (!confirm('Ordner wirklich löschen? Die Dateien darin werden in die Hauptliste verschoben.')) return;
    try {
      await deleteFolder(id);
      setFolders(prev => prev.filter(f => f.id !== id));
      setTranscriptions(prev => prev.map(t => t.folder_id === id ? { ...t, folder_id: null } : t));
      if (activeFolderId === id) setActiveFolderId(null);
    } catch (err) {
      alert('Ordner konnte nicht gelöscht werden');
    }
  }, [activeFolderId]);

  const handleMoveToFolder = useCallback(async (transcriptionId, folderId) => {
    try {
      await updateTranscription(transcriptionId, { folderId });
      setTranscriptions(prev => prev.map(t => t.id === transcriptionId ? { ...t, folder_id: folderId } : t));
    } catch (err) {
      alert('Datei konnte nicht verschoben werden');
    }
  }, []);

  const handleToggleFavorite = useCallback(async (transcriptionId, currentStatus) => {
    try {
      await updateTranscription(transcriptionId, { isFavorite: !currentStatus });
      setTranscriptions(prev => prev.map(t => t.id === transcriptionId ? { ...t, is_favorite: !currentStatus } : t));
    } catch (err) {
      alert('Favoriten-Status konnte nicht geändert werden');
    }
  }, []);

  const handleDeleteTranscription = useCallback(async (id) => {
    if (!confirm('Datei unwiderruflich löschen?')) return;
    try {
      await deleteTranscription(id);
      setTranscriptions(prev => prev.filter(t => t.id !== id));
    } catch (err) {
      alert('Fehler beim Löschen: ' + (err.message || 'Unbekannter Fehler'));
    }
  }, []);

  const filteredTranscriptions = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return transcriptions.filter(t => {
      const matchesFolder = activeFolderId === null || t.folder_id === activeFolderId;
      const matchesSearch = normalizedQuery === ''
        ? true
        : (t.original_name || t.filename || '').toLowerCase().includes(normalizedQuery);
      return matchesFolder && matchesSearch;
    });
  }, [transcriptions, activeFolderId, searchQuery]);

  if (status === 'loading' || (status === 'unauthenticated')) return null;

  return (
    <>
      <Head>
        <title>Historie - GhostTyper</title>
      </Head>

      <div className="w-full flex flex-col md:flex-row gap-8 min-h-[60vh]">
        {/* Sidebar: Folders */}
        <aside className="w-full md:w-64 shrink-0">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[10px] font-bold text-text-secondary uppercase tracking-[0.2em]">Ordner</h2>
            <button 
              onClick={() => setIsCreatingFolder(true)} 
              className="p-1 hover:bg-white/5 rounded text-accent-orange transition-colors"
              title="Neuer Ordner"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            </button>
          </div>

          <div className="space-y-1">
            <button
              onClick={() => setActiveFolderId(null)}
              className={`w-full text-left px-3 py-2 rounded-xl text-sm transition-all flex items-center gap-3 ${activeFolderId === null ? 'bg-accent-orange text-white shadow-lg shadow-accent-orange/20' : 'text-text-secondary hover:bg-white/5'}`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
              Alle Dateien
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
                  className="w-full bg-dark-input border border-accent-orange/50 rounded-lg px-2 py-1 text-xs text-text-primary outline-none"
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
                      className="w-full bg-dark-input border border-accent-orange/50 rounded-lg px-2 py-1 text-xs text-text-primary outline-none"
                    />
                  </div>
                ) : (
                  <div className="flex items-center">
                    <button
                      onClick={() => setActiveFolderId(folder.id)}
                      className={`flex-1 text-left px-3 py-2 rounded-xl text-sm transition-all flex items-center gap-3 min-w-0 ${activeFolderId === folder.id ? 'bg-accent-orange/20 text-accent-orange border border-accent-orange/20' : 'text-text-secondary hover:bg-white/5'}`}
                    >
                      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
                      <span className="truncate">{folder.name}</span>
                    </button>
                    
                    <div className="absolute right-2 flex gap-1 transition-opacity opacity-100 md:opacity-0 md:group-hover:opacity-100">
                      <button 
                        onClick={() => { setEditingFolderId(folder.id); setEditFolderName(folder.name); }}
                        className="p-1 text-text-secondary hover:text-white"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                      </button>
                      <button 
                        onClick={() => handleDeleteFolder(folder.id)}
                        className="p-1 text-text-secondary hover:text-accent-red"
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
            <h1 className="text-2xl font-semibold text-text-primary truncate min-w-0">
              {activeFolderId === null ? 'Alle Dateien' : folders.find(f => f.id === activeFolderId)?.name}
            </h1>
            
            <div className="flex items-center gap-3 w-full lg:w-auto min-w-0">
              <div className="relative flex-1 lg:flex-initial min-w-0">
                <svg className="w-4 h-4 text-text-secondary absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                <input 
                  type="text" 
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Suchen..." 
                  className="bg-dark-input border border-white/[0.1] rounded-xl pl-9 pr-4 py-2 text-xs text-text-primary outline-none focus:ring-1 focus:ring-accent-orange w-full lg:w-64"
                />
              </div>
              <div className="text-[10px] text-text-secondary uppercase tracking-widest font-bold whitespace-nowrap hidden xl:block">
                {filteredTranscriptions.length} {filteredTranscriptions.length === 1 ? 'Eintrag' : 'Einträge'}
              </div>
            </div>
          </div>

          {loading ? (
            <LoadingSpinner />
          ) : filteredTranscriptions.length === 0 ? (
            <div className="bg-dark-card border border-white/[0.06] rounded-xl p-12 text-center">
              <div className="w-16 h-16 bg-white/[0.06] rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <p className="text-text-primary font-medium mb-1">
                {searchQuery ? 'Keine Ergebnisse für Ihre Suche' : 'Dieser Ordner ist leer'}
              </p>
              <p className="text-sm text-text-secondary">
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
    </>
  );
}
