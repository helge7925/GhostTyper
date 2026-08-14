import Head from 'next/head';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { Mail, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import LoadingSpinner from '../../../components/LoadingSpinner';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { Skeleton } from '../../../components/ui/skeleton';
import { useCurrentOrg } from '../../../lib/use-current-org';
import { usePermission } from '../../../lib/use-permission';
import { ROLES } from '../../../lib/permissions';

function RoleSelect({ value, onChange, disabled }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      className="bg-surface-elevated border border-subtle rounded-md px-2 py-1 text-xs text-primary outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
    >
      {ROLES.map((r) => (
        <option key={r} value={r}>{r}</option>
      ))}
    </select>
  );
}

export default function MembersPage() {
  const router = useRouter();
  const { status: authStatus } = useSession();
  const { org, isLoading: orgLoading } = useCurrentOrg();
  const canManage = usePermission('org.members.write');
  const canInvite = usePermission('org.invites.create');

  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [confirmRole, setConfirmRole] = useState(null);

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.replace('/login?next=/settings/organization/members');
    }
  }, [authStatus, router]);

  const refresh = useCallback(async () => {
    if (!org) return;
    setLoading(true);
    try {
      const [m, i] = await Promise.all([
        fetch('/api/organizations/members').then((r) => (r.ok ? r.json() : { members: [] })),
        canInvite
          ? fetch('/api/organizations/invites').then((r) => (r.ok ? r.json() : { invites: [] }))
          : Promise.resolve({ invites: [] }),
      ]);
      setMembers(m.members || []);
      setInvites(i.invites || []);
    } finally {
      setLoading(false);
    }
  }, [org, canInvite]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleRoleChange = async (memberUserId, newRole, reason) => {
    setBusy(true);
    try {
      const res = await fetch('/api/organizations/members', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberUserId, role: newRole, reason }),
      });
      if (!res.ok) throw new Error((await res.json()).message || 'Fehler');
      toast.success('Rolle aktualisiert');
      await refresh();
    } catch (err) {
      toast.error(err.message || 'Rollenänderung fehlgeschlagen');
    } finally {
      setBusy(false);
      setConfirmRole(null);
    }
  };

  const handleRemove = async (member, reason) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/organizations/members?userId=${member.id}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }),
      });
      if (!res.ok) throw new Error((await res.json()).message || 'Fehler');
      toast.success(`${member.email} entfernt`);
      await refresh();
    } catch (err) {
      toast.error(err.message || 'Entfernen fehlgeschlagen');
    } finally {
      setBusy(false);
      setConfirmRemove(null);
    }
  };

  const handleInvite = async (event) => {
    event.preventDefault();
    if (!inviteEmail.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/organizations/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      if (!res.ok) throw new Error((await res.json()).message || 'Fehler');
      toast.success(`Einladung an ${inviteEmail} erstellt`);
      setInviteEmail('');
      setInviteRole('member');
      await refresh();
    } catch (err) {
      toast.error(err.message || 'Einladung fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };

  const handleRevokeInvite = async (inviteId) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/organizations/invites?id=${inviteId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).message || 'Fehler');
      toast.success('Einladung zurückgezogen');
      await refresh();
    } catch (err) {
      toast.error(err.message || 'Zurückziehen fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };

  if (authStatus === 'loading' || orgLoading) {
    return <LoadingSpinner />;
  }
  if (!org) {
    return <main className="max-w-3xl mx-auto py-12 text-center text-secondary">Kein Workspace verfügbar.</main>;
  }

  return (
    <>
      <Head>
        <title>Mitglieder – {org.name}</title>
      </Head>
      <main className="max-w-5xl mx-auto pb-20 animate-fade-in space-y-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Link href="/settings/organization" className="text-xs text-secondary hover:text-primary">
              ← Workspace
            </Link>
            <h1 className="text-2xl font-bold text-primary mt-1">Mitglieder & Rollen</h1>
            <p className="text-sm text-secondary mt-1">
              {org.name} · {members.length} aktive Mitglieder
            </p>
          </div>
        </div>

        {/* Invite form */}
        {canInvite && (
          <section className="bg-surface border border-subtle rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-primary flex items-center gap-2">
              <UserPlus className="w-4 h-4" aria-hidden="true" /> Mitglied einladen
            </h2>
            <form onSubmit={handleInvite} className="mt-4 grid grid-cols-1 md:grid-cols-[1fr_180px_auto] gap-3">
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="name@example.com"
                disabled={busy}
                className="bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-sm text-primary outline-none focus:ring-2 focus:ring-accent"
              />
              <RoleSelect value={inviteRole} onChange={setInviteRole} disabled={busy} />
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-2 rounded-lg gradient-accent text-white text-sm font-semibold disabled:opacity-50"
              >
                Einladung senden
              </button>
            </form>
            <p className="mt-2 text-[11px] text-secondary">
              In Phase 4 wird der Token erzeugt und im Audit-Log protokolliert. Der E-Mail-Versand folgt in Phase 4c (SMTP-Konfiguration).
            </p>
          </section>
        )}

        {/* Members list */}
        <section className="bg-surface border border-subtle rounded-2xl overflow-hidden">
          <header className="px-5 py-3 border-b border-subtle text-xs font-bold uppercase tracking-widest text-secondary">
            Mitglieder
          </header>
          {loading ? (
            <div className="p-5 space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : members.length === 0 ? (
            <p className="p-6 text-sm text-secondary text-center">Keine Mitglieder.</p>
          ) : (
            <ul className="divide-y divide-subtle">
              {members.map((member) => (
                <li key={member.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  {member.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={member.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover border border-subtle" />
                  ) : (
                    <span className="w-9 h-9 rounded-full bg-hover-strong flex items-center justify-center text-xs font-bold text-primary">
                      {(member.email || '??').substring(0, 2).toUpperCase()}
                    </span>
                  )}
                  <div className="flex-1 min-w-[180px]">
                    <p className="text-sm font-medium text-primary truncate">{member.name || member.email}</p>
                    <p className="text-[11px] text-secondary truncate">{member.email}</p>
                  </div>

                  {canManage ? (
                    <RoleSelect
                      value={member.role}
                      onChange={(next) => setConfirmRole({ member, role: next })}
                      disabled={busy}
                    />
                  ) : (
                    <span className="text-[11px] uppercase tracking-wider text-secondary">{member.role}</span>
                  )}
                  {canManage && (
                    <>
                      <button
                        type="button"
                        onClick={() => setConfirmRemove(member)}
                        disabled={busy}
                        className="p-2 rounded-lg text-secondary hover:text-danger hover:bg-danger/10 transition-colors disabled:opacity-50"
                        aria-label={`${member.email} entfernen`}
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Pending invites */}
        {canInvite && invites.length > 0 && (
          <section className="bg-surface border border-subtle rounded-2xl overflow-hidden">
            <header className="px-5 py-3 border-b border-subtle text-xs font-bold uppercase tracking-widest text-secondary flex items-center gap-2">
              <Mail className="w-3.5 h-3.5" aria-hidden="true" /> Offene Einladungen
            </header>
            <ul className="divide-y divide-subtle">
              {invites.filter((i) => !i.accepted_at).map((invite) => (
                <li key={invite.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-primary truncate">{invite.email}</p>
                    <p className="text-[11px] text-secondary">
                      {invite.role} · läuft ab {new Date(invite.expires_at).toLocaleDateString('de-DE')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRevokeInvite(invite.id)}
                    disabled={busy}
                    className="text-[11px] text-secondary hover:text-danger transition-colors disabled:opacity-50"
                  >
                    Zurückziehen
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <ConfirmDialog
        open={!!confirmRemove}
        title="Mitglied entfernen"
        message={`${confirmRemove?.email} wirklich aus diesem Workspace entfernen?`}
        confirmLabel="Entfernen"
        danger
        busy={busy}
        reasonRequired
        onConfirm={(reason) => confirmRemove && handleRemove(confirmRemove, reason)}
        onCancel={() => setConfirmRemove(null)}
      />

      <ConfirmDialog
        open={!!confirmRole}
        title="Rolle ändern"
        message={`Rolle von ${confirmRole?.member?.email || ''} auf ${confirmRole?.role || ''} ändern?`}
        confirmLabel="Rolle ändern"
        busy={busy}
        reasonRequired
        onConfirm={(reason) => confirmRole && handleRoleChange(confirmRole.member.id, confirmRole.role, reason)}
        onCancel={() => setConfirmRole(null)}
      />

    </>
  );
}
