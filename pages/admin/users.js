import Head from 'next/head';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { useState, useEffect, useCallback } from 'react';

export default function AdminUsers() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Form state
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRole, setFormRole] = useState('user');
  const [formApiKey, setFormApiKey] = useState('');
  const [formCostLimit, setFormCostLimit] = useState('');

  const loadUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/users');
      if (!res.ok) throw new Error();
      setUsers(await res.json());
    } catch {
      setError('Fehler beim Laden der User-Liste');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
      return;
    }
    if (status === 'authenticated') {
      if (session.user.role !== 'admin') {
        router.push('/');
        return;
      }
      loadUsers();
    }
  }, [status, session, router, loadUsers]);

  function resetForm() {
    setFormName('');
    setFormEmail('');
    setFormPassword('');
    setFormRole('user');
    setFormApiKey('');
    setFormCostLimit('');
    setEditingUser(null);
    setShowForm(false);
    setError('');
  }

  function startEdit(user) {
    setFormName(user.name || '');
    setFormEmail(user.email);
    setFormPassword('');
    setFormRole(user.role);
    setFormApiKey('');
    setFormCostLimit(user.cost_limit ?? '');
    setEditingUser(user);
    setShowForm(true);
    setError('');
  }

  function startCreate() {
    resetForm();
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');

    try {
      if (editingUser) {
        // Update
        const body = {
          email: formEmail,
          name: formName,
          role: formRole,
        };
        if (formPassword) body.password = formPassword;
        if (formApiKey) body.mistralApiKey = formApiKey;
        if (formCostLimit !== '' && formCostLimit !== editingUser.cost_limit) {
          body.costLimit = formCostLimit === '' ? null : parseFloat(formCostLimit);
        }

        const res = await fetch(`/api/admin/users/${editingUser.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const data = await res.json();
          setError(data.message || 'Aktualisierung fehlgeschlagen');
          return;
        }

        setSuccess('User aktualisiert');
      } else {
        // Create
        if (!formEmail || !formPassword) {
          setError('Email und Passwort sind erforderlich');
          return;
        }

        const res = await fetch('/api/admin/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: formEmail,
            name: formName,
            password: formPassword,
            role: formRole,
          }),
        });

        if (!res.ok) {
          const data = await res.json();
          setError(data.message || 'Erstellung fehlgeschlagen');
          return;
        }

        setSuccess('User erstellt');
      }

      resetForm();
      loadUsers();
      setTimeout(() => setSuccess(''), 3000);
    } catch {
      setError('Ein Fehler ist aufgetreten');
    }
  }

  async function handleDelete(user) {
    if (!confirm(`User "${user.email}" wirklich löschen? Alle Daten werden gelöscht.`)) return;

    try {
      const res = await fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        setError(data.message || 'Löschung fehlgeschlagen');
        return;
      }
      setSuccess('User gelöscht');
      loadUsers();
      setTimeout(() => setSuccess(''), 3000);
    } catch {
      setError('Ein Fehler ist aufgetreten');
    }
  }

  if (status === 'loading' || loading) return null;
  if (!session || session.user.role !== 'admin') return null;

  return (
    <>
      <Head>
        <title>User-Verwaltung - GhostTyper</title>
      </Head>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-text-primary">User-Verwaltung</h1>
        {!showForm && (
          <button
            onClick={startCreate}
            className="gradient-accent text-white px-5 py-2 rounded-full text-sm font-medium transition-colors"
          >
            Neuer User
          </button>
        )}
      </div>

      {success && (
        <div className="bg-accent-green/10 border border-accent-green/20 text-accent-green px-4 py-3 rounded-lg text-sm mb-4">
          {success}
        </div>
      )}

      {error && !showForm && (
        <p className="text-sm text-accent-red mb-4">{error}</p>
      )}

      {showForm && (
        <div className="bg-dark-card border border-white/[0.06] rounded-xl p-6 mb-6">
          <h2 className="text-base font-medium text-text-primary mb-4">
            {editingUser ? `User bearbeiten: ${editingUser.email}` : 'Neuen User erstellen'}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">Name</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Max Mustermann"
                  className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder-text-secondary focus:ring-2 focus:ring-accent-orange focus:border-accent-orange outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">Email *</label>
                <input
                  type="email"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  required
                  className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder-text-secondary focus:ring-2 focus:ring-accent-orange focus:border-accent-orange outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">
                  Passwort {editingUser ? '(leer = unverändert)' : '*'}
                </label>
                <input
                  type="password"
                  value={formPassword}
                  onChange={(e) => setFormPassword(e.target.value)}
                  required={!editingUser}
                  placeholder={editingUser ? 'Neues Passwort eingeben' : 'Mindestens 8 Zeichen'}
                  className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder-text-secondary focus:ring-2 focus:ring-accent-orange focus:border-accent-orange outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">Rolle</label>
                <select
                  value={formRole}
                  onChange={(e) => setFormRole(e.target.value)}
                  className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary focus:ring-2 focus:ring-accent-orange focus:border-accent-orange outline-none"
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>

            {editingUser && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-white/[0.06] pt-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1.5">
                    Mistral API-Key {editingUser.api_key_configured && '(konfiguriert)'}
                  </label>
                  <input
                    type="password"
                    value={formApiKey}
                    onChange={(e) => setFormApiKey(e.target.value)}
                    placeholder={editingUser.api_key_configured ? 'Neuen Key eingeben zum Ändern' : 'API-Key eingeben'}
                    className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder-text-secondary focus:ring-2 focus:ring-accent-orange focus:border-accent-orange outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1.5">
                    Monatliches Kostenlimit (€)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formCostLimit}
                    onChange={(e) => setFormCostLimit(e.target.value)}
                    placeholder="Unbegrenzt"
                    className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder-text-secondary focus:ring-2 focus:ring-accent-orange focus:border-accent-orange outline-none"
                  />
                </div>
              </div>
            )}

            {error && showForm && (
              <p className="text-sm text-accent-red">{error}</p>
            )}

            <div className="flex gap-3">
              <button
                type="submit"
                className="gradient-accent text-white py-2.5 px-6 rounded-full text-sm font-medium transition-colors"
              >
                {editingUser ? 'Speichern' : 'Erstellen'}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="border border-white/[0.12] text-text-secondary px-6 py-2.5 rounded-full text-sm font-medium hover:bg-white/[0.06] transition-colors"
              >
                Abbrechen
              </button>
            </div>
          </form>
        </div>
      )}

      {/* User list */}
      <div className="space-y-3">
        {users.map((user) => (
          <div key={user.id} className="bg-dark-card border border-white/[0.06] rounded-xl p-4 flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-text-primary truncate">
                  {user.name || user.email}
                </span>
                {user.role === 'admin' && (
                  <span className="text-xs bg-accent-orange/20 text-accent-orange px-2 py-0.5 rounded-full">
                    Admin
                  </span>
                )}
                {user.api_key_configured && (
                  <span className="text-xs bg-accent-green/20 text-accent-green px-2 py-0.5 rounded-full">
                    API-Key
                  </span>
                )}
                {user.cost_limit && (
                  <span className="text-xs bg-accent-yellow/20 text-accent-yellow px-2 py-0.5 rounded-full">
                    Limit: {user.cost_limit} €
                  </span>
                )}
              </div>
              <p className="text-xs text-text-secondary mt-0.5">{user.email}</p>
            </div>

            <div className="flex items-center gap-2 ml-4">
              <button
                onClick={() => startEdit(user)}
                className="text-xs text-text-secondary hover:text-text-primary hover:bg-white/[0.06] px-3 py-1.5 rounded-full transition-colors"
              >
                Bearbeiten
              </button>
              {user.id !== session.user.id && (
                <button
                  onClick={() => handleDelete(user)}
                  className="text-xs text-accent-red/70 hover:text-accent-red hover:bg-accent-red/10 px-3 py-1.5 rounded-full transition-colors"
                >
                  Löschen
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {users.length === 0 && !loading && (
        <div className="bg-dark-card border border-white/[0.06] rounded-xl p-12 text-center">
          <p className="text-text-secondary text-sm">Keine User vorhanden.</p>
        </div>
      )}
    </>
  );
}