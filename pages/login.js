import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { signIn } from 'next-auth/react';
import { useState } from 'react';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError('Email oder Passwort ist falsch.');
    } else {
      router.push('/');
    }
  }

  return (
    <>
      <Head>
        <title>Anmelden - Transkription</title>
      </Head>

      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="w-full max-w-sm">
          <div className="bg-white rounded-lg shadow-card p-8">
            <div className="text-center mb-8">
              <h1 className="text-2xl font-semibold text-google-gray-900">Anmelden</h1>
              <p className="text-sm text-google-gray-600 mt-1">
                Bei Transkription WebApp anmelden
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
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
                  autoFocus
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
                {loading ? 'Wird angemeldet...' : 'Anmelden'}
              </button>
            </form>

            <p className="text-sm text-google-gray-600 text-center mt-6">
              Noch kein Konto?{' '}
              <Link href="/register" className="text-google-blue font-medium hover:underline">
                Registrieren
              </Link>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
