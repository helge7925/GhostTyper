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
        <title>Registrieren - Transkription</title>
      </Head>

      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="w-full max-w-sm">
          <div className="bg-white rounded-lg shadow-card p-8">
            <div className="text-center mb-8">
              <h1 className="text-2xl font-semibold text-google-gray-900">Konto erstellen</h1>
              <p className="text-sm text-google-gray-600 mt-1">
                Registrieren Sie sich für die Transkription WebApp
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-google-gray-700 mb-1.5">
                  Name
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                  className="w-full border border-google-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-google-blue focus:border-google-blue outline-none transition-shadow"
                  placeholder="Max Mustermann"
                />
              </div>

              <div>
                <label htmlFor="email" className="block text-sm font-medium text-google-gray-700 mb-1.5">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full border border-google-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-google-blue focus:border-google-blue outline-none transition-shadow"
                  placeholder="name@beispiel.de"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-google-gray-700 mb-1.5">
                  Passwort
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full border border-google-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-google-blue focus:border-google-blue outline-none transition-shadow"
                  placeholder="Mindestens 8 Zeichen"
                />
              </div>

              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-google-gray-700 mb-1.5">
                  Passwort bestätigen
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="w-full border border-google-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-google-blue focus:border-google-blue outline-none transition-shadow"
                />
              </div>

              {error && (
                <p className="text-sm text-google-red">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-google-blue text-white py-2.5 rounded-full text-sm font-medium hover:bg-google-blue-hover disabled:opacity-50 transition-colors"
              >
                {loading ? 'Wird registriert...' : 'Konto erstellen'}
              </button>
            </form>

            <p className="text-sm text-google-gray-600 text-center mt-6">
              Bereits ein Konto?{' '}
              <Link href="/login" className="text-google-blue font-medium hover:underline">
                Anmelden
              </Link>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
