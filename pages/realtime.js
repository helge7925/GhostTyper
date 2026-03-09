import Head from 'next/head';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import LoadingSpinner from '../components/LoadingSpinner';
import {
  addRealtimeSessionMember,
  createRealtimeSession,
  getRealtimeSession,
  getRealtimeSessions,
  getTemplates,
  ingestRealtimeSessionChunk,
  removeRealtimeSessionMember,
  updateRealtimeSession,
} from '../lib/api';

const ROLE_LABELS = {
  owner: 'Owner',
  editor: 'Editor',
  viewer: 'Viewer',
};

const NODE_COLORS = {
  topic: '#06b6d4',
  person: '#f59e0b',
  project: '#22c55e',
  task: '#f97316',
  decision: '#eab308',
  date: '#8b5cf6',
};

const BUILTIN_TEMPLATE_OPTIONS = [
  { value: 'generic', label: 'Zusammenfassung (Standard)' },
  { value: 'meeting', label: 'Meeting-Protokoll' },
  { value: 'aufmass', label: 'Aufmaß' },
];

function GraphView({ graph }) {
  const nodes = useMemo(() => {
    const items = Array.isArray(graph?.nodes) ? graph.nodes : [];
    return items.slice(0, 28);
  }, [graph]);

  const edges = useMemo(() => {
    const items = Array.isArray(graph?.edges) ? graph.edges : [];
    const nodeSet = new Set(nodes.map((node) => node.id));
    return items.filter((edge) => nodeSet.has(edge.source) && nodeSet.has(edge.target)).slice(0, 50);
  }, [graph, nodes]);

  const positionMap = useMemo(() => {
    const map = new Map();
    if (nodes.length === 0) return map;
    const cx = 360;
    const cy = 220;
    const ring = Math.max(130, 24 * Math.sqrt(nodes.length));
    nodes.forEach((node, index) => {
      const angle = (Math.PI * 2 * index) / nodes.length;
      map.set(node.id, {
        x: cx + ring * Math.cos(angle),
        y: cy + ring * Math.sin(angle),
      });
    });
    return map;
  }, [nodes]);

  if (nodes.length === 0) {
    return <p className="text-xs text-text-secondary">Noch keine Graphdaten vorhanden.</p>;
  }

  return (
    <div className="border border-white/[0.08] rounded-2xl overflow-hidden bg-[#05060a]">
      <svg viewBox="0 0 720 440" className="w-full h-[360px] md:h-[440px]">
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="2" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {edges.map((edge) => {
          const source = positionMap.get(edge.source);
          const target = positionMap.get(edge.target);
          if (!source || !target) return null;
          return (
            <line
              key={edge.id}
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              stroke="rgba(148, 163, 184, 0.35)"
              strokeWidth={Math.min(4, 1 + Number(edge.count || 1) * 0.25)}
            />
          );
        })}

        {nodes.map((node) => {
          const pos = positionMap.get(node.id);
          if (!pos) return null;
          const fill = NODE_COLORS[node.type] || '#64748b';
          return (
            <g key={node.id} transform={`translate(${pos.x}, ${pos.y})`} filter="url(#glow)">
              <circle r={Math.min(30, 11 + Number(node.count || 1) * 1.4)} fill={fill} fillOpacity="0.9" />
              <text
                x={0}
                y={4}
                textAnchor="middle"
                fontSize="9"
                fill="#111827"
                fontWeight="700"
              >
                {String(node.label || '').slice(0, 18)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden'));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

function pickRecorderMimeType() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
  ];
  const match = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  return match || '';
}

export default function RealtimePage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [sessions, setSessions] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [activeSession, setActiveSession] = useState(null);
  const [newSessionTitle, setNewSessionTitle] = useState('');
  const [newSessionTemplate, setNewSessionTemplate] = useState('generic');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('viewer');
  const [manualChunk, setManualChunk] = useState('');
  const [templates, setTemplates] = useState([]);
  const [recording, setRecording] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingMeta, setSavingMeta] = useState(false);

  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const sendQueueRef = useRef([]);
  const sendingRef = useRef(false);

  const canWrite = activeSession?.my_role === 'owner' || activeSession?.my_role === 'editor';
  const canManageMembers = activeSession?.my_role === 'owner';
  const templateOptions = useMemo(() => {
    const customOptions = (templates || [])
      .filter((entry) => entry?.template_type !== 'table')
      .map((entry) => ({
        value: `custom-${entry.id}`,
        label: `${entry.name} (Eigene Vorlage)`,
      }));
    return [...BUILTIN_TEMPLATE_OPTIONS, ...customOptions];
  }, [templates]);

  const templateLabelMap = useMemo(
    () => new Map(templateOptions.map((entry) => [entry.value, entry.label])),
    [templateOptions]
  );

  const loadSessions = useCallback(async () => {
    const rows = await getRealtimeSessions();
    setSessions(rows);
    if (!selectedId && rows.length > 0) {
      setSelectedId(rows[0].id);
    }
    return rows;
  }, [selectedId]);

  const loadActiveSession = useCallback(async (sessionId) => {
    if (!sessionId) return null;
    const details = await getRealtimeSession(sessionId);
    setActiveSession(details);
    return details;
  }, []);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    let mounted = true;
    setLoading(true);
    Promise.resolve()
      .then(async () => {
        const [sessionsResult, templatesResult] = await Promise.allSettled([
          loadSessions(),
          getTemplates(),
        ]);
        if (sessionsResult.status !== 'fulfilled') {
          throw sessionsResult.reason;
        }
        const rows = sessionsResult.value;
        const templateRows = templatesResult.status === 'fulfilled' ? templatesResult.value : [];
        if (!mounted) return;
        setTemplates(templateRows || []);
        const nextSelected = selectedId || rows[0]?.id || null;
        if (nextSelected) {
          await loadActiveSession(nextSelected);
        }
      })
      .catch((err) => {
        setError(err.message || 'Echtzeit-Sessions konnten nicht geladen werden.');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [status, loadSessions, loadActiveSession, selectedId]);

  useEffect(() => {
    if (!selectedId || status !== 'authenticated') return undefined;

    let eventSource = null;
    let fallbackInterval = null;

    const handleSnapshot = (snapshot) => {
      setActiveSession(snapshot);
      setSessions((prev) => prev.map((entry) => (
        entry.id === snapshot.id
          ? { ...entry, title: snapshot.title, status: snapshot.status, updated_at: snapshot.updated_at, my_role: snapshot.my_role }
          : entry
      )));
    };

    const startFallback = () => {
      if (fallbackInterval) return;
      fallbackInterval = setInterval(async () => {
        try {
          const snapshot = await getRealtimeSession(selectedId);
          handleSnapshot(snapshot);
        } catch {
          // ignore transient polling errors
        }
      }, 2500);
    };

    if (typeof window !== 'undefined' && 'EventSource' in window) {
      eventSource = new EventSource(`/api/realtime/sessions/${selectedId}/stream`);
      eventSource.addEventListener('snapshot', (event) => {
        try {
          handleSnapshot(JSON.parse(event.data));
        } catch {
          // ignore malformed packets
        }
      });
      eventSource.addEventListener('missing', () => {
        eventSource?.close();
      });
      eventSource.onerror = () => {
        eventSource?.close();
        startFallback();
      };
    } else {
      startFallback();
    }

    return () => {
      if (eventSource) eventSource.close();
      if (fallbackInterval) clearInterval(fallbackInterval);
    };
  }, [selectedId, status]);

  const processQueue = useCallback(async () => {
    if (sendingRef.current) return;
    const next = sendQueueRef.current.shift();
    if (!next) return;

    sendingRef.current = true;
    try {
      const payload = await ingestRealtimeSessionChunk(next.sessionId, {
        audioBase64: next.dataUrl,
        mimeType: next.mimeType,
      });
      if (payload?.snapshot) {
        setActiveSession(payload.snapshot);
      }
    } catch (err) {
      setError(err.message || 'Audio-Chunk konnte nicht verarbeitet werden.');
    } finally {
      sendingRef.current = false;
      if (sendQueueRef.current.length > 0) {
        queueMicrotask(() => {
          processQueue();
        });
      }
    }
  }, []);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    mediaRecorderRef.current = null;

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    setRecording(false);
  }, []);

  const startRecording = useCallback(async () => {
    if (!selectedId) {
      setError('Bitte zuerst eine Realtime-Session wählen.');
      return;
    }
    if (!canWrite) {
      setError('Keine Schreibberechtigung in dieser Session.');
      return;
    }

    try {
      setError('');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const mimeType = pickRecorderMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = async (event) => {
        if (!event.data || event.data.size === 0) return;
        try {
          const dataUrl = await blobToDataUrl(event.data);
          sendQueueRef.current.push({
            sessionId: selectedId,
            dataUrl,
            mimeType: event.data.type || mimeType || 'audio/webm',
          });
          processQueue();
        } catch (err) {
          setError(err.message || 'Audio konnte nicht gelesen werden.');
        }
      };

      recorder.onerror = () => {
        setError('Aufnahmefehler. Bitte erneut starten.');
        stopRecording();
      };

      recorder.start(2500);
      setRecording(true);
    } catch (err) {
      setError(err.message || 'Mikrofonzugriff fehlgeschlagen.');
      stopRecording();
    }
  }, [selectedId, canWrite, processQueue, stopRecording]);

  useEffect(() => () => {
    stopRecording();
  }, [stopRecording]);

  async function handleCreateSession() {
    try {
      setError('');
      const created = await createRealtimeSession({
        title: newSessionTitle,
        documentTemplate: newSessionTemplate,
      });
      setNewSessionTitle('');
      setNewSessionTemplate('generic');
      await loadSessions();
      setSelectedId(created.id);
      setActiveSession(created);
    } catch (err) {
      setError(err.message || 'Session konnte nicht erstellt werden.');
    }
  }

  async function handleSessionSelect(sessionId) {
    if (!sessionId) return;
    setSelectedId(sessionId);
    try {
      const details = await loadActiveSession(sessionId);
      setActiveSession(details);
    } catch (err) {
      setError(err.message || 'Session konnte nicht geladen werden.');
    }
  }

  async function handleInviteMember() {
    if (!selectedId || !inviteEmail.trim()) return;
    try {
      setError('');
      await addRealtimeSessionMember(selectedId, {
        email: inviteEmail.trim(),
        role: inviteRole,
      });
      setInviteEmail('');
      const details = await loadActiveSession(selectedId);
      setActiveSession(details);
    } catch (err) {
      setError(err.message || 'Mitglied konnte nicht hinzugefügt werden.');
    }
  }

  async function handleRemoveMember(userId) {
    if (!selectedId) return;
    try {
      setError('');
      const members = await removeRealtimeSessionMember(selectedId, userId);
      setActiveSession((prev) => prev ? { ...prev, members } : prev);
    } catch (err) {
      setError(err.message || 'Mitglied konnte nicht entfernt werden.');
    }
  }

  async function handleManualChunkSubmit(e) {
    e.preventDefault();
    if (!selectedId || !manualChunk.trim()) return;
    try {
      setError('');
      const payload = await ingestRealtimeSessionChunk(selectedId, { text: manualChunk.trim() });
      setManualChunk('');
      if (payload?.snapshot) {
        setActiveSession(payload.snapshot);
      }
    } catch (err) {
      setError(err.message || 'Text-Chunk konnte nicht gesendet werden.');
    }
  }

  async function handleStatusChange(nextStatus) {
    if (!selectedId) return;
    try {
      setSavingMeta(true);
      setError('');
      const updated = await updateRealtimeSession(selectedId, { status: nextStatus });
      setActiveSession(updated);
      setSessions((prev) => prev.map((entry) => (
        entry.id === updated.id
          ? { ...entry, status: updated.status, updated_at: updated.updated_at }
          : entry
      )));
    } catch (err) {
      setError(err.message || 'Status konnte nicht geändert werden.');
    } finally {
      setSavingMeta(false);
    }
  }

  async function handleTemplateChange(nextTemplate) {
    if (!selectedId) return;
    try {
      setSavingMeta(true);
      setError('');
      const updated = await updateRealtimeSession(selectedId, { documentTemplate: nextTemplate });
      setActiveSession(updated);
      setSessions((prev) => prev.map((entry) => (
        entry.id === updated.id
          ? { ...entry, document_template: updated.document_template, updated_at: updated.updated_at }
          : entry
      )));
    } catch (err) {
      setError(err.message || 'Dokument-Vorlage konnte nicht geändert werden.');
    } finally {
      setSavingMeta(false);
    }
  }

  if (status === 'loading' || loading) {
    return <LoadingSpinner />;
  }
  if (!session) {
    return <LoadingSpinner />;
  }

  return (
    <>
      <Head>
        <title>Echtzeitverarbeitung - GhostTyper</title>
      </Head>

      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Echtzeitverarbeitung</h1>
          <p className="text-sm text-text-secondary mt-1">
            Live-Transkript, Live-Dokument und Live-Wissensgraph in einer gemeinsamen Session.
          </p>
        </div>

        {error && (
          <div className="bg-accent-red/10 border border-accent-red/30 text-accent-red rounded-xl px-4 py-3 text-sm">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-4">
            <div className="bg-dark-card border border-white/[0.06] rounded-2xl p-4">
              <label htmlFor="realtime-new-session-title" className="block text-[10px] font-bold text-text-secondary uppercase tracking-widest mb-2">
                Neue Session
              </label>
              <div className="space-y-2">
                <input
                  id="realtime-new-session-title"
                  value={newSessionTitle}
                  onChange={(e) => setNewSessionTitle(e.target.value)}
                  placeholder="z. B. Weekly Team Sync"
                  className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-text-primary outline-none"
                />
                <div className="flex flex-col sm:flex-row sm:items-stretch gap-2 min-w-0">
                  <select
                    value={newSessionTemplate}
                    onChange={(e) => setNewSessionTemplate(e.target.value)}
                    className="w-full min-w-0 sm:flex-1 bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-text-primary outline-none"
                  >
                    {templateOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleCreateSession}
                    className="w-full sm:w-auto px-4 py-2 rounded-lg bg-accent-orange/20 text-accent-orange text-sm font-semibold border border-accent-orange/30"
                  >
                    Start
                  </button>
                </div>
              </div>
            </div>

            <div className="bg-dark-card border border-white/[0.06] rounded-2xl p-4">
              <p className="text-[10px] font-bold text-text-secondary uppercase tracking-widest mb-3">Sessions</p>
              <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                {sessions.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => handleSessionSelect(entry.id)}
                    className={`w-full text-left rounded-xl px-3 py-2 border transition-colors ${entry.id === selectedId
                        ? 'border-accent-orange/40 bg-accent-orange/10'
                        : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05]'
                      }`}
                  >
                    <p className="text-sm text-text-primary font-medium">{entry.title}</p>
                    <p className="text-[11px] text-text-secondary mt-1">
                      {ROLE_LABELS[entry.my_role] || entry.my_role} • {entry.status}
                    </p>
                  </button>
                ))}
                {sessions.length === 0 && (
                  <p className="text-xs text-text-secondary">Noch keine Echtzeit-Sessions vorhanden.</p>
                )}
              </div>
            </div>
          </div>

          <div className="lg:col-span-2 space-y-4">
            {activeSession ? (
              <>
                <div className="bg-dark-card border border-white/[0.06] rounded-2xl p-4 space-y-4">
                  <div className="flex flex-wrap items-center gap-3 justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-text-primary">{activeSession.title}</h2>
                      <p className="text-xs text-text-secondary mt-1">
                        Rolle: {ROLE_LABELS[activeSession.my_role] || activeSession.my_role} • Status: {activeSession.status}
                      </p>
                      <p className="text-xs text-text-secondary mt-1">
                        Dokument-Vorlage: {templateLabelMap.get(activeSession.document_template) || activeSession.document_template || 'Zusammenfassung (Standard)'}
                      </p>
                      {activeSession.status === 'completed' && (
                        <p className="text-[11px] mt-1 text-text-secondary">
                          Finalisierung:
                          {' '}
                          <span
                            className={
                              activeSession.finalization_state === 'done'
                                ? 'text-accent-green'
                                : activeSession.finalization_state === 'failed'
                                  ? 'text-accent-red'
                                  : 'text-accent-yellow'
                            }
                          >
                            {activeSession.finalization_state || 'idle'}
                          </span>
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleStatusChange('active')}
                        disabled={!canWrite || savingMeta}
                        className="px-3 py-1.5 rounded-lg text-xs border border-green-400/30 text-green-300 bg-green-500/10 disabled:opacity-40"
                      >
                        Aktiv
                      </button>
                      <button
                        type="button"
                        onClick={() => handleStatusChange('paused')}
                        disabled={!canWrite || savingMeta}
                        className="px-3 py-1.5 rounded-lg text-xs border border-yellow-400/30 text-yellow-300 bg-yellow-500/10 disabled:opacity-40"
                      >
                        Pausieren
                      </button>
                      <button
                        type="button"
                        onClick={() => handleStatusChange('completed')}
                        disabled={!canWrite || savingMeta}
                        className="px-3 py-1.5 rounded-lg text-xs border border-white/20 text-text-secondary bg-white/[0.03] disabled:opacity-40"
                      >
                        Abschließen
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <select
                      value={activeSession.document_template || 'generic'}
                      onChange={(e) => handleTemplateChange(e.target.value)}
                      disabled={!canWrite || savingMeta}
                      className="px-3 py-2 rounded-xl bg-dark-input border border-white/[0.12] text-sm text-text-primary outline-none disabled:opacity-40"
                    >
                      {templateOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    {!recording ? (
                      <button
                        type="button"
                        onClick={startRecording}
                        disabled={!canWrite || activeSession.status === 'completed'}
                        className="px-4 py-2 rounded-xl bg-accent-orange/20 text-accent-orange border border-accent-orange/30 text-sm font-semibold disabled:opacity-40"
                      >
                        Live-Aufnahme starten
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={stopRecording}
                        className="px-4 py-2 rounded-xl bg-accent-red/20 text-accent-red border border-accent-red/40 text-sm font-semibold"
                      >
                        Aufnahme stoppen
                      </button>
                    )}

                    <span className="text-xs text-text-secondary self-center">
                      {recording ? 'Mikrofon aktiv, Chunks werden live transkribiert.' : 'Mikrofon inaktiv.'}
                    </span>
                  </div>

                  <form onSubmit={handleManualChunkSubmit} className="space-y-2">
                    <label htmlFor="realtime-manual-chunk" className="block text-[10px] font-bold text-text-secondary uppercase tracking-widest">
                      Test- / Manuell-Chunk
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="realtime-manual-chunk"
                        value={manualChunk}
                        onChange={(e) => setManualChunk(e.target.value)}
                        placeholder="Manuellen Satz einspeisen..."
                        className="flex-1 bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-text-primary outline-none"
                      />
                      <button
                        type="submit"
                        disabled={!canWrite || !manualChunk.trim()}
                        className="px-3 py-2 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-400/30 text-sm font-semibold disabled:opacity-40"
                      >
                        Senden
                      </button>
                    </div>
                  </form>

                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    <div>
                      <p className="text-[10px] font-bold text-text-secondary uppercase tracking-widest mb-2">
                        Live-Transkript
                      </p>
                      <pre className="bg-dark-input border border-white/[0.08] rounded-xl p-3 text-xs text-text-primary whitespace-pre-wrap h-[280px] overflow-y-auto">
                        {activeSession.transcript_text || 'Noch kein Live-Transkript vorhanden.'}
                      </pre>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-text-secondary uppercase tracking-widest mb-2">
                        Live-Dokument (Markdown)
                      </p>
                      <pre className="bg-dark-input border border-white/[0.08] rounded-xl p-3 text-xs text-text-primary whitespace-pre-wrap h-[280px] overflow-y-auto">
                        {activeSession.document_markdown || 'Noch kein Live-Dokument vorhanden.'}
                      </pre>
                    </div>
                  </div>
                  {activeSession.finalization_state === 'failed' && (
                    <div className="text-xs border border-accent-red/30 bg-accent-red/10 text-accent-red rounded-xl px-3 py-2">
                      Finalisierung fehlgeschlagen: {activeSession.finalization_error || 'Unbekannter Fehler'}
                    </div>
                  )}
                </div>

                <div className="bg-dark-card border border-white/[0.06] rounded-2xl p-4">
                  <p className="text-[10px] font-bold text-text-secondary uppercase tracking-widest mb-3">Wissensgraph (Live)</p>
                  <GraphView graph={activeSession.graph_json} />
                </div>

                <div className="bg-dark-card border border-white/[0.06] rounded-2xl p-4 space-y-3">
                  <p className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Team-Mitglieder</p>
                  <div className="space-y-2">
                    {(activeSession.members || []).map((member) => (
                      <div key={member.user_id} className="flex items-center justify-between rounded-lg px-3 py-2 border border-white/[0.08] bg-white/[0.02]">
                        <div>
                          <p className="text-sm text-text-primary">{member.name || member.email}</p>
                          <p className="text-[11px] text-text-secondary">{member.email} • {ROLE_LABELS[member.role] || member.role}</p>
                        </div>
                        {canManageMembers && member.role !== 'owner' && (
                          <button
                            type="button"
                            onClick={() => handleRemoveMember(member.user_id)}
                            className="text-xs text-accent-red hover:text-red-300"
                          >
                            Entfernen
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  {canManageMembers && (
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2 pt-1">
                      <label htmlFor="realtime-invite-email" className="sr-only">Mitglieds-E-Mail</label>
                      <input
                        id="realtime-invite-email"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        placeholder="teammitglied@firma.de"
                        className="bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-text-primary outline-none"
                      />
                      <label htmlFor="realtime-invite-role" className="sr-only">Rolle</label>
                      <select
                        id="realtime-invite-role"
                        value={inviteRole}
                        onChange={(e) => setInviteRole(e.target.value)}
                        className="bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-text-primary outline-none"
                      >
                        <option value="viewer">Viewer</option>
                        <option value="editor">Editor</option>
                      </select>
                      <button
                        type="button"
                        onClick={handleInviteMember}
                        className="px-3 py-2 rounded-lg bg-white/[0.08] text-text-primary text-sm border border-white/[0.12]"
                      >
                        Hinzufügen
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="bg-dark-card border border-white/[0.06] rounded-2xl p-6 text-sm text-text-secondary">
                Wählen Sie eine Session aus oder starten Sie eine neue Echtzeitverarbeitungs-Session.
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
