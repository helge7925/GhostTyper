import Head from 'next/head';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { useState, useEffect, useCallback } from 'react';
import LoadingSpinner from '../../components/LoadingSpinner';
import Toast from '../../components/Toast';
import ConfirmDialog from '../../components/ConfirmDialog';
import { useUiFeedback } from '../../lib/use-ui-feedback';

export default function AdminUsers() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [retentionEnabled, setRetentionEnabled] = useState(false);
  const [retentionDays, setRetentionDays] = useState('');
  const {
    toast,
    showToast,
    clearToast,
    confirmDialog,
    confirm,
    closeConfirm,
    acceptConfirm,
  } = useUiFeedback();

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
      showToast('Fehler beim Laden der User-Liste', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const loadEnterpriseSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/enterprise-settings');
      if (!res.ok) return;
      const data = await res.json();
      setRetentionEnabled(Boolean(data.retentionDays));
      setRetentionDays(data.retentionDays ?? '');
    } catch {
      // Non-blocking admin setting.
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
      loadEnterpriseSettings();
    }
  }, [status, session, router, loadUsers, loadEnterpriseSettings]);

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
    const approved = await confirm({
      title: 'Benutzer löschen',
      message: `User "${user.email}" wirklich löschen? Alle Daten werden gelöscht.`,
      confirmLabel: 'Benutzer löschen',
      danger: true,
    });
    if (!approved) return;

    try {
      const res = await fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        setError(data.message || 'Löschung fehlgeschlagen');
        return;
      }
      setSuccess('User gelöscht');
      showToast('User gelöscht', 'success');
      loadUsers();
      setTimeout(() => setSuccess(''), 3000);
    } catch {
      setError('Ein Fehler ist aufgetreten');
      showToast('Ein Fehler ist aufgetreten', 'error');
    }
  }

  async function handleSaveRetention(event) {
    event.preventDefault();
    try {
      const res = await fetch('/api/admin/enterprise-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: retentionEnabled,
          retentionDays: retentionEnabled ? retentionDays : null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Aufbewahrung konnte nicht gespeichert werden');
      }
      showToast('Aufbewahrung gespeichert', 'success');
      loadEnterpriseSettings();
    } catch (err) {
      showToast(err.message || 'Aufbewahrung konnte nicht gespeichert werden', 'error');
    }
  }

  if (status === 'loading' || loading) return <LoadingSpinner />;
  if (!session || session.user.role !== 'admin') return <LoadingSpinner />;

  return (
    <>
      <Head>
        <title>User-Verwaltung - GhostTyper</title>
      </Head>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-primary">User-Verwaltung</h1>
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
        <div className="bg-success/10 border border-success/20 text-success px-4 py-3 rounded-lg text-sm mb-4">
          {success}
        </div>
      )}

      {error && !showForm && (
        <p className="text-sm text-danger mb-4">{error}</p>
      )}

      <form onSubmit={handleSaveRetention} className="bg-surface border border-subtle rounded-xl p-6 mb-6">
        <h2 className="text-base font-medium text-primary">Datenaufbewahrung</h2>
        <p className="text-xs text-secondary mt-1">
          Standardmäßig ist keine automatische Löschung aktiv. Der Cleanup läuft nur, wenn `npm run retention:apply` geplant ausgeführt wird.
        </p>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-end">
          <label className="flex items-center gap-3 text-sm text-primary">
            <input
              type="checkbox"
              checked={retentionEnabled}
              onChange={(event) => setRetentionEnabled(event.target.checked)}
              className="w-4 h-4 accent-accent"
            />
            Automatische Aufbewahrungsfrist aktivieren
          </label>
          <div className="flex items-end gap-3">
            <div>
              <label htmlFor="retention-days" className="block text-xs text-secondary mb-1">Tage</label>
              <input
                id="retention-days"
                type="number"
                min="1"
                max="3650"
                value={retentionDays}
                onChange={(event) => setRetentionDays(event.target.value)}
                disabled={!retentionEnabled}
                className="w-32 bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-sm text-primary outline-none disabled:opacity-50"
              />
            </div>
            <button type="submit" className="bg-hover-subtle hover:bg-hover-strong text-primary border border-subtle px-4 py-2 rounded-lg text-sm">
              Speichern
            </button>
          </div>
        </div>
      </form>

      {showForm && (
        <div className="bg-surface border border-subtle rounded-xl p-6 mb-6">
          <h2 className="text-base font-medium text-primary mb-4">
            {editingUser ? `User bearbeiten: ${editingUser.email}` : 'Neuen User erstellen'}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="admin-user-name" className="block text-sm font-medium text-secondary mb-1.5">Name</label>
                <input
                  id="admin-user-name"
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Max Mustermann"
                  className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2.5 text-sm text-primary placeholder-text-secondary focus:ring-2 focus:ring-accent focus:border-accent outline-none"
                />
              </div>

              <div>
                <label htmlFor="admin-user-email" className="block text-sm font-medium text-secondary mb-1.5">Email *</label>
                <input
                  id="admin-user-email"
                  type="email"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  required
                  className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2.5 text-sm text-primary placeholder-text-secondary focus:ring-2 focus:ring-accent focus:border-accent outline-none"
                />
              </div>

              <div>
                <label htmlFor="admin-user-password" className="block text-sm font-medium text-secondary mb-1.5">
                  Passwort {editingUser ? '(leer = unverändert)' : '*'}
                </label>
                <input
                  id="admin-user-password"
                  type="password"
                  value={formPassword}
                  onChange={(e) => setFormPassword(e.target.value)}
                  required={!editingUser}
                  placeholder={editingUser ? 'Neues Passwort eingeben' : 'Mindestens 8 Zeichen'}
                  className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2.5 text-sm text-primary placeholder-text-secondary focus:ring-2 focus:ring-accent focus:border-accent outline-none"
                />
              </div>

              <div>
                <label htmlFor="admin-user-role" className="block text-sm font-medium text-secondary mb-1.5">Rolle</label>
                <select
                  id="admin-user-role"
                  value={formRole}
                  onChange={(e) => setFormRole(e.target.value)}
                  className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2.5 text-sm text-primary focus:ring-2 focus:ring-accent focus:border-accent outline-none"
                >
                  <option value="user">User</option>
                  <option value="auditor">Auditor</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>

            {editingUser && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-subtle pt-4">
                <div>
                  <label htmlFor="admin-user-api-key" className="block text-sm font-medium text-secondary mb-1.5">
                    Mistral API-Key {editingUser.api_key_configured && '(konfiguriert)'}
                  </label>
                  <input
                    id="admin-user-api-key"
                    type="password"
                    value={formApiKey}
                    onChange={(e) => setFormApiKey(e.target.value)}
                    placeholder={editingUser.api_key_configured ? 'Neuen Key eingeben zum Ändern' : 'API-Key eingeben'}
                    className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2.5 text-sm text-primary placeholder-text-secondary focus:ring-2 focus:ring-accent focus:border-accent outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="admin-user-cost-limit" className="block text-sm font-medium text-secondary mb-1.5">
                    Monatliches Kostenlimit (€)
                  </label>
                  <input
                    id="admin-user-cost-limit"
                    type="number"
                    step="0.01"
                    min="0"
                    value={formCostLimit}
                    onChange={(e) => setFormCostLimit(e.target.value)}
                    placeholder="Unbegrenzt"
                    className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2.5 text-sm text-primary placeholder-text-secondary focus:ring-2 focus:ring-accent focus:border-accent outline-none"
                  />
                </div>
              </div>
            )}

            {error && showForm && (
              <p className="text-sm text-danger">{error}</p>
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
                className="border border-emphasis text-secondary px-6 py-2.5 rounded-full text-sm font-medium hover:bg-hover transition-colors"
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
          <div key={user.id} className="bg-surface border border-subtle rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-primary truncate">
                  {user.name || user.email}
                </span>
                {user.role === 'admin' && (
                  <span className="text-xs bg-accent/20 text-accent px-2 py-0.5 rounded-full">
                    Admin
                  </span>
                )}
                {user.role === 'auditor' && (
                  <span className="text-xs bg-info/20 text-info px-2 py-0.5 rounded-full">
                    Auditor
                  </span>
                )}
                {user.api_key_configured && (
                  <span className="text-xs bg-success/20 text-success px-2 py-0.5 rounded-full">
                    Mistral API
                  </span>
                )}
                {user.cost_limit !== null && user.cost_limit !== undefined && (
                  <span className="text-xs bg-warning/20 text-warning px-2 py-0.5 rounded-full">
                    Limit: {user.cost_limit} €
                  </span>
                )}
              </div>
              <p className="text-xs text-secondary mt-0.5">{user.email}</p>
            </div>

            <div className="w-full sm:w-auto flex items-center gap-2 sm:justify-end">
              <button
                onClick={() => startEdit(user)}
                className="text-xs text-secondary hover:text-primary hover:bg-hover px-3 py-1.5 rounded-full transition-colors"
              >
                Bearbeiten
              </button>
              {user.id !== session.user.id && (
                <button
                  onClick={() => handleDelete(user)}
                  className="text-xs text-danger/70 hover:text-danger hover:bg-danger/10 px-3 py-1.5 rounded-full transition-colors"
                >
                  Löschen
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {users.length === 0 && !loading && (
        <div className="bg-surface border border-subtle rounded-xl p-12 text-center">
          <p className="text-secondary text-sm">Keine User vorhanden.</p>
        </div>
      )}
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
