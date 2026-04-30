import Head from 'next/head';
import { useRouter } from 'next/router';
import { getProviders, signIn } from 'next-auth/react';
import { useEffect, useState } from 'react';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState(null);

  useEffect(() => {
    getProviders().then((items) => setProviders(items || {})).catch(() => setProviders({}));
  }, []);

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
        <title>Anmelden - GhostTyper</title>
      </Head>

      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo-text.png"
              alt="GhostTyper"
              width={180}
              height={48}
              className="h-12 w-auto mx-auto mb-2"
            />
            <p className="text-sm text-secondary">
              Ihre Gedanken, entschlüsselt und auf den Punkt gebracht.
            </p>
          </div>
          <div className="bg-surface border border-subtle rounded-2xl p-8 shadow-2xl">
            {providers?.oidc && (
              <button
                type="button"
                onClick={() => signIn('oidc', { callbackUrl: '/' })}
                className="w-full gradient-accent text-white py-2.5 rounded-full text-sm font-medium transition-colors mb-5"
              >
                Mit Single Sign-On anmelden
              </button>
            )}

            {providers?.credentials && (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-secondary mb-1.5">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2.5 text-sm text-primary placeholder-text-secondary focus:ring-2 focus:ring-accent focus:border-accent outline-none transition-shadow"
                  placeholder="name@beispiel.de"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-secondary mb-1.5">
                  Passwort
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2.5 text-sm text-primary placeholder-text-secondary focus:ring-2 focus:ring-accent focus:border-accent outline-none transition-shadow"
                />
              </div>

              {error && (
                <p className="text-sm text-danger">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full gradient-accent text-white py-2.5 rounded-full text-sm font-medium disabled:opacity-50 transition-colors"
              >
                {loading ? 'Wird angemeldet...' : 'Anmelden'}
              </button>
            </form>
            )}

            {providers && !providers.credentials && !providers.oidc && (
              <p className="text-sm text-secondary text-center">
                Es ist kein Anmeldeverfahren konfiguriert. Bitte wenden Sie sich an den Administrator.
              </p>
            )}

            <p className="text-sm text-secondary text-center mt-6">
              Kein Konto? Wenden Sie sich an den Administrator.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
