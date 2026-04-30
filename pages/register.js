import Head from 'next/head';
import Link from 'next/link';

export default function Register() {
  return (
    <>
      <Head>
        <title>Registrierung - GhostTyper</title>
      </Head>

      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="w-full max-w-sm">
          <div className="bg-surface border border-subtle rounded-xl p-8 text-center">
            <div className="w-14 h-14 bg-accent/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h1 className="text-xl font-semibold text-primary mb-2">
              Registrierung deaktiviert
            </h1>
            <p className="text-sm text-secondary mb-6">
              Neue Konten können nur vom Administrator erstellt werden.
              Bitte wenden Sie sich an Ihren Administrator.
            </p>
            <Link
              href="/login"
              className="inline-block gradient-accent text-white px-6 py-2.5 rounded-full text-sm font-medium transition-colors"
            >
              Zur Anmeldung
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
