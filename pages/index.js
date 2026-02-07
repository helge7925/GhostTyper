import Head from 'next/head';
import Link from 'next/link';
import { useSession } from 'next-auth/react';

export default function Home() {
  const { data: session } = useSession();

  if (!session) {
    return (
      <>
        <Head>
          <title>Transkription WebApp</title>
        </Head>

        <div className="min-h-[70vh] flex items-center justify-center">
          <div className="text-center max-w-lg">
            <h1 className="text-4xl font-semibold text-google-gray-900 mb-4">
              Transkription
            </h1>
            <p className="text-lg text-google-gray-600 mb-8">
              Audio-Transkription und intelligente Analyse mit Mistral AI.
              Meetings, Aufmaße und mehr — automatisch strukturiert.
            </p>
            <div className="flex gap-3 justify-center">
              <Link
                href="/login"
                className="bg-google-blue text-white px-6 py-2.5 rounded-full text-sm font-medium hover:bg-google-blue-hover transition-colors"
              >
                Anmelden
              </Link>
              <Link
                href="/register"
                className="border border-google-gray-300 text-google-blue px-6 py-2.5 rounded-full text-sm font-medium hover:bg-google-gray-50 transition-colors"
              >
                Konto erstellen
              </Link>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>Transkription WebApp</title>
      </Head>

      <div className="py-4">
        <h1 className="text-2xl font-semibold text-google-gray-900 mb-1">
          Hallo{session.user.name ? `, ${session.user.name}` : ''}
        </h1>
        <p className="text-google-gray-600 mb-8">Was möchten Sie tun?</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link
            href="/upload"
            className="bg-white rounded-lg shadow-card hover:shadow-card-hover p-6 transition-shadow"
          >
            <div className="w-10 h-10 bg-blue-50 rounded-full flex items-center justify-center mb-4">
              <svg className="w-5 h-5 text-google-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <h2 className="text-base font-medium text-google-gray-900 mb-1">Audio hochladen</h2>
            <p className="text-sm text-google-gray-600">
              Audiodatei für Transkription und Analyse hochladen.
            </p>
          </Link>

          <Link
            href="/transcriptions"
            className="bg-white rounded-lg shadow-card hover:shadow-card-hover p-6 transition-shadow"
          >
            <div className="w-10 h-10 bg-green-50 rounded-full flex items-center justify-center mb-4">
              <svg className="w-5 h-5 text-google-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h2 className="text-base font-medium text-google-gray-900 mb-1">Transkriptionen</h2>
            <p className="text-sm text-google-gray-600">
              Vergangene Transkriptionen und Analysen einsehen.
            </p>
          </Link>

          <Link
            href="/settings"
            className="bg-white rounded-lg shadow-card hover:shadow-card-hover p-6 transition-shadow"
          >
            <div className="w-10 h-10 bg-orange-50 rounded-full flex items-center justify-center mb-4">
              <svg className="w-5 h-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <h2 className="text-base font-medium text-google-gray-900 mb-1">Einstellungen</h2>
            <p className="text-sm text-google-gray-600">
              API-Key und Voreinstellungen konfigurieren.
            </p>
          </Link>
        </div>
      </div>
    </>
  );
}
