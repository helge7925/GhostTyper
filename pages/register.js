import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { signIn } from 'next-auth/react';
import { useState } from 'react';

export default function Register() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwörter stimmen nicht überein.');
      return;
    }

    if (password.length < 8) {
      setError('Passwort muss mindestens 8 Zeichen lang sein.');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || 'Registrierung fehlgeschlagen.');
        setLoading(false);
        return;
      }

      // Auto-login after registration
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });

      setLoading(false);

      if (result?.ok) {
        router.push('/');
      }
    } catch {
      setError('Ein Fehler ist aufgetreten.');
      setLoading(false);
    }
  }

  return (
    <>
      <Head>
        <title>Registrieren - GhostTyper</title>
      </Head>

      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="w-full max-w-sm">
          <div className="bg-dark-card border border-white/[0.06] rounded-xl p-8">
            <div className="text-center mb-8">
              <h1 className="text-2xl font-semibold text-text-primary">Konto erstellen</h1>
              <p className="text-sm text-text-secondary mt-1">
                Registrieren Sie sich für GhostTyper
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-text-secondary mb-1.5">
                  Name
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                  className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder-text-secondary focus:ring-2 focus:ring-accent-purple focus:border-accent-purple outline-none transition-shadow"
                  placeholder="Max Mustermann"
                />
              </div>

              <div>
                <label htmlFor="email" className="block text-sm font-medium text-text-secondary mb-1.5">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder-text-secondary focus:ring-2 focus:ring-accent-purple focus:border-accent-purple outline-none transition-shadow"
                  placeholder="name@beispiel.de"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-text-secondary mb-1.5">
                  Passwort
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder-text-secondary focus:ring-2 focus:ring-accent-purple focus:border-accent-purple outline-none transition-shadow"
                  placeholder="Mindestens 8 Zeichen"
                />
              </div>

              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-text-secondary mb-1.5">
                  Passwort bestätigen
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder-text-secondary focus:ring-2 focus:ring-accent-purple focus:border-accent-purple outline-none transition-shadow"
                />
              </div>

              {error && (
                <p className="text-sm text-accent-red">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full gradient-accent text-white py-2.5 rounded-full text-sm font-medium disabled:opacity-50 transition-colors"
              >
                {loading ? 'Wird registriert...' : 'Konto erstellen'}
              </button>
            </form>

            <p className="text-sm text-text-secondary text-center mt-6">
              Bereits ein Konto?{' '}
              <Link href="/login" className="text-accent-purple font-medium hover:underline">
                Anmelden
              </Link>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
