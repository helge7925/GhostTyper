import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { CheckSquare, ExternalLink } from 'lucide-react';
import LoadingSpinner from '../components/LoadingSpinner';
import Toast from '../components/Toast';
import { useTranslations } from '../lib/i18n';

const STATUS_OPTIONS = ['proposed', 'open', 'done', 'dismissed'];

function sourceHref(task) {
  if (!task.transcription_id) return null;
  const segmentIds = Array.isArray(task.source_segment_ids) ? task.source_segment_ids : [];
  const firstSegment = segmentIds.find((id) => Number.isFinite(Number(id)));
  return `/transcriptions/${task.transcription_id}${firstSegment ? `#segment-${firstSegment}` : '#transcript'}`;
}

export default function TasksPage() {
  const { status } = useSession();
  const tNav = useTranslations('nav');
  const [tasks, setTasks] = useState([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter) params.set('status', filter);
      const res = await fetch(`/api/tasks?${params.toString()}`, { credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Aufgaben konnten nicht geladen werden.');
      setTasks(data.tasks || []);
    } catch (error) {
      setToast({ type: 'error', message: error.message || 'Aufgaben konnten nicht geladen werden.' });
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    if (status === 'authenticated') loadTasks();
  }, [status, loadTasks]);

  const counts = useMemo(() => tasks.reduce((acc, task) => {
    acc[task.status] = (acc[task.status] || 0) + 1;
    return acc;
  }, {}), [tasks]);

  const updateStatus = async (taskId, nextStatus) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Aufgabe konnte nicht aktualisiert werden.');
      setTasks((prev) => prev.map((task) => (task.id === taskId ? { ...task, ...data.task } : task)));
    } catch (error) {
      setToast({ type: 'error', message: error.message || 'Aufgabe konnte nicht aktualisiert werden.' });
    }
  };

  if (status === 'loading' || loading) return <LoadingSpinner />;

  return (
    <>
      <Head><title>{`${tNav('tasks')} - GhostTyper`}</title></Head>
      <div className="max-w-6xl mx-auto animate-fade-in pb-20">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
          <div>
            <div className="w-12 h-12 rounded-2xl bg-accent/10 text-accent flex items-center justify-center mb-3">
              <CheckSquare className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold text-primary">Aufgaben</h1>
            <p className="text-sm text-secondary mt-1">Extrahierte Aufgaben prüfen, übernehmen und nachverfolgen.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setFilter('')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${filter === '' ? 'bg-accent text-white border-accent' : 'border-subtle text-secondary hover:text-primary'}`}
            >
              Alle
            </button>
            {STATUS_OPTIONS.map((statusOption) => (
              <button
                key={statusOption}
                type="button"
                onClick={() => setFilter(statusOption)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${filter === statusOption ? 'bg-accent text-white border-accent' : 'border-subtle text-secondary hover:text-primary'}`}
              >
                {statusOption} {counts[statusOption] ? `(${counts[statusOption]})` : ''}
              </button>
            ))}
          </div>
        </div>

        {tasks.length === 0 ? (
          <div className="bg-surface border border-subtle rounded-2xl p-8 text-center text-secondary">
            Keine Aufgaben gefunden.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {tasks.map((task) => {
              const href = sourceHref(task);
              return (
                <article key={task.id} className="bg-surface border border-subtle rounded-2xl p-5 shadow-xl">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-subtle text-secondary">{task.status}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent/10 text-accent">{task.priority}</span>
                      </div>
                      <h2 className="text-base font-semibold text-primary">{task.title}</h2>
                      {task.description && <p className="text-sm text-secondary mt-2">{task.description}</p>}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 mt-3 text-xs text-secondary">
                    {(task.assignee_name || task.assignee_text) && <span>Verantwortlich: {task.assignee_name || task.assignee_text}</span>}
                    {task.due_date && <span>Fällig: {new Date(task.due_date).toLocaleDateString('de-DE')}</span>}
                    {task.transcription_title && <span>Quelle: {task.transcription_title}</span>}
                  </div>

                  {task.evidence && (
                    <blockquote className="mt-3 border-l-2 border-accent/30 pl-3 text-xs text-secondary italic">
                      {task.evidence}
                    </blockquote>
                  )}

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {task.status === 'proposed' && (
                      <button type="button" onClick={() => updateStatus(task.id, 'open')} className="px-3 py-1.5 rounded-lg bg-success/10 text-success text-xs font-semibold">Übernehmen</button>
                    )}
                    {task.status === 'open' && (
                      <button type="button" onClick={() => updateStatus(task.id, 'done')} className="px-3 py-1.5 rounded-lg bg-success/10 text-success text-xs font-semibold">Erledigt</button>
                    )}
                    {task.status !== 'dismissed' && task.status !== 'done' && (
                      <button type="button" onClick={() => updateStatus(task.id, 'dismissed')} className="px-3 py-1.5 rounded-lg bg-danger/10 text-danger text-xs font-semibold">Verwerfen</button>
                    )}
                    {href && (
                      <Link href={href} className="ml-auto inline-flex items-center gap-1 text-xs text-accent hover:text-info font-semibold">
                        Quelle öffnen <ExternalLink className="w-3 h-3" />
                      </Link>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  );
}
