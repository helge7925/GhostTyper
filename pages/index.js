import Head from 'next/head';
import Link from 'next/link';

export default function Home() {
  return (
    <>
      <Head>
        <title>Transkription WebApp</title>
      </Head>

      <div className="flex flex-col items-center text-center py-12">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">
          Willkommen bei der Transkription WebApp
        </h1>
        <p className="text-lg text-gray-600 mb-12 max-w-xl">
          Eine moderne Webanwendung für Audio-Transkription und Analyse
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-3xl">
          <Link
            href="/upload"
            className="border border-gray-200 rounded-lg p-6 text-left hover:border-blue-500 hover:shadow-md transition-all"
          >
            <h2 className="text-xl font-semibold mb-2">
              Audio hochladen &rarr;
            </h2>
            <p className="text-gray-600">
              Laden Sie Audio-Dateien für die Transkription hoch.
            </p>
          </Link>

          <Link
            href="/transcriptions"
            className="border border-gray-200 rounded-lg p-6 text-left hover:border-blue-500 hover:shadow-md transition-all"
          >
            <h2 className="text-xl font-semibold mb-2">
              Transkriptionen &rarr;
            </h2>
            <p className="text-gray-600">
              Verwalten Sie Ihre Transkriptionen und Analysen.
            </p>
          </Link>

          <Link
            href="/settings"
            className="border border-gray-200 rounded-lg p-6 text-left hover:border-blue-500 hover:shadow-md transition-all"
          >
            <h2 className="text-xl font-semibold mb-2">
              Einstellungen &rarr;
            </h2>
            <p className="text-gray-600">
              Konfigurieren Sie Ihre Benutzereinstellungen.
            </p>
          </Link>
        </div>
      </div>
    </>
  );
}
