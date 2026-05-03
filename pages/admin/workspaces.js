import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { Building2, Plus, Users as UsersIcon } from 'lucide-react';
import { toast } from 'sonner';
import LoadingSpinner from '../../components/LoadingSpinner';
import { useTranslations } from '../../lib/i18n';

export default function AdminWorkspacesPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const tNav = useTranslations('nav');

  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login?next=/admin/workspaces');
    } else if (status === 'authenticated' && session?.user?.role !== 'admin') {
      router.replace('/');
    }
  }, [status, session, router]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/organizations');
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setOrgs(data.organizations || []);
    } catch (err) {
      toast.error('Konnte Workspaces nicht laden.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === 'authenticated' && session?.user?.role === 'admin') refresh();
  }, [status, session, refresh]);

  const resetForm = () => {
    setName('');
    setSlug('');
    setOwnerEmail('');
    setShowCreate(false);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/admin/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim() || undefined,
          ownerEmail: ownerEmail.trim() || undefined,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.message || 'Fehler');
      toast.success(`Workspace "${payload.name}" angelegt.`);
      resetForm();
      await refresh();
    } catch (err) {
      toast.error(err.message || 'Erstellung fehlgeschlagen');
    } finally {
      setCreating(false);
    }
  };

  if (status !== 'authenticated' || session?.user?.role !== 'admin') {
    return <LoadingSpinner />;
  }

  return (
    <>
      <Head>
        <title>Workspaces – Admin</title>
      </Head>
      <main className="max-w-5xl mx-auto pb-20 animate-fade-in space-y-6">
        <header className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-secondary">Admin</p>
            <h1 className="text-2xl font-bold text-primary mt-1 flex items-center gap-2">
              <Building2 className="w-5 h-5" /> Workspaces
            </h1>
            <p className="text-sm text-secondary mt-1 max-w-prose">
              Globale Verwaltung aller Workspaces. Neue Workspaces können nur durch System-Admins angelegt werden.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/admin/users"
              className="text-xs text-secondary hover:text-primary transition-colors whitespace-nowrap"
            >
              ← Nutzerverwaltung
            </Link>
            <button
              type="button"
              onClick={() => setShowCreate((v) => !v)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm bg-accent text-white hover:bg-accent/90 transition-colors"
            >
              <Plus className="w-4 h-4" /> Neuer Workspace
            </button>
          </div>
        </header>

        {showCreate && (
          <form
            onSubmit={handleCreate}
            className="bg-surface border border-subtle rounded-2xl p-6 shadow-xl space-y-4"
          >
            <h2 className="text-sm font-semibold text-primary">Neuen Workspace anlegen</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-secondary mb-1.5">Name *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Mein Team"
                  disabled={creating}
                  className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-sm text-primary outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-secondary mb-1.5">Slug (optional)</label>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="auto aus Name"
                  disabled={creating}
                  className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-sm text-primary outline-none focus:border-accent"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary mb-1.5">Owner (E-Mail eines existierenden Users)</label>
              <input
                type="email"
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                placeholder={session?.user?.email || 'auto: ich selbst'}
                disabled={creating}
                className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-sm text-primary outline-none focus:border-accent"
              />
              <p className="mt-1 text-[10px] text-secondary italic">Wenn leer, wirst du selbst Owner.</p>
            </div>
            <div className="flex justify-end gap-3 pt-3 border-t border-subtle">
              <button
                type="button"
                onClick={resetForm}
                disabled={creating}
                className="px-4 py-2 rounded-xl text-sm border border-subtle text-primary hover:bg-hover-subtle disabled:opacity-50"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                disabled={creating || !name.trim()}
                className="px-4 py-2 rounded-xl text-sm bg-accent text-white hover:bg-accent/90 disabled:opacity-50"
              >
                {creating ? 'Lege an...' : 'Workspace anlegen'}
              </button>
            </div>
          </form>
        )}

        <section className="bg-surface border border-subtle rounded-2xl shadow-xl overflow-hidden">
          <header className="px-5 py-3 border-b border-subtle text-xs font-bold uppercase tracking-widest text-secondary">
            Alle Workspaces ({orgs.length})
          </header>
          {loading ? (
            <div className="p-6 text-sm text-secondary"><LoadingSpinner /></div>
          ) : orgs.length === 0 ? (
            <p className="p-6 text-sm text-secondary text-center">Keine Workspaces vorhanden.</p>
          ) : (
            <ul className="divide-y divide-subtle">
              {orgs.map((o) => (
                <li key={o.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="w-9 h-9 rounded-full bg-hover-strong flex items-center justify-center text-xs font-bold text-primary">
                    {o.name.substring(0, 2).toUpperCase()}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-primary truncate">
                      {o.name}
                      {o.is_personal && (
                        <span className="ml-2 text-[10px] uppercase text-secondary tracking-wider">persönlich</span>
                      )}
                    </p>
                    <p className="text-[11px] text-secondary truncate font-mono">{o.slug}</p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-[11px] text-secondary tabular-nums">
                    <UsersIcon className="w-3 h-3" /> {o.member_count} Mitglieder
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
