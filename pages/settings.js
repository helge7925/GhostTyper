import Head from 'next/head';
import { useState } from 'react';

export default function Settings() {
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState(false);

  function handleSave(e) {
    e.preventDefault();
    // Stub: will connect to API in later phase
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  return (
    <>
      <Head>
        <title>Einstellungen - Transkription WebApp</title>
      </Head>

      <h1 className="text-2xl font-bold text-gray-900 mb-6">Einstellungen</h1>

      <form onSubmit={handleSave} className="max-w-xl space-y-6">
        <div>
          <label htmlFor="apiKey" className="block text-sm font-medium text-gray-700 mb-1">
            OpenAI API-Key
          </label>
          <input
            id="apiKey"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
          <p className="text-xs text-gray-400 mt-1">
            Wird für die Whisper-Transkription benötigt.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Analyse-Templates
          </label>
          <div className="border border-gray-200 rounded-lg p-4 text-sm text-gray-400 italic">
            Template-Verwaltung wird in einer späteren Phase implementiert.
          </div>
        </div>

        {saved && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">
            Einstellungen gespeichert.
          </div>
        )}

        <button
          type="submit"
          className="bg-blue-600 text-white py-2 px-6 rounded-lg font-medium hover:bg-blue-700 transition-colors"
        >
          Speichern
        </button>
      </form>
    </>
  );
}
