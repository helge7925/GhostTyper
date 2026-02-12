import Head from 'next/head';
import Image from 'next/image';
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
        <title>Anmelden - GhostTyper</title>
      </Head>

      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <Image
              src="/logo-text.png"
              alt="GhostTyper"
              width={180}
              height={48}
              className="h-12 w-auto mx-auto mb-2"
              priority
            />
            <p className="text-sm text-text-secondary">
              Your thought, decoded and distilled.
            </p>
          </div>
          <div className="bg-dark-card border border-white/[0.06] rounded-2xl p-8 shadow-2xl">
            <form onSubmit={handleSubmit} className="space-y-5">
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
                  autoFocus
                  className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder-text-secondary focus:ring-2 focus:ring-accent-orange focus:border-accent-orange outline-none transition-shadow"
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
                  className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder-text-secondary focus:ring-2 focus:ring-accent-orange focus:border-accent-orange outline-none transition-shadow"
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
                {loading ? 'Wird angemeldet...' : 'Anmelden'}
              </button>
            </form>

            <p className="text-sm text-text-secondary text-center mt-6">
              Kein Konto? Wenden Sie sich an den Administrator.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
