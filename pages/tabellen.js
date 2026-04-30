import Head from 'next/head';
import { useRouter } from 'next/router';
import TabellenTranskription from './tabellen-transkription';
import Datentabelle from './datentabelle';

export default function Tabellen() {
  const router = useRouter();
  const mode = router.query.mode === 'free' ? 'free' : 'template';

  function setMode(nextMode) {
    router.push(`/tabellen?mode=${nextMode}`, undefined, { shallow: true });
  }

  return (
    <>
      <Head>
        <title>Tabellen - GhostTyper</title>
      </Head>

      <div className="max-w-5xl mx-auto mb-6">
        <div className="inline-flex rounded-2xl border border-subtle bg-surface p-1">
          <button
            type="button"
            onClick={() => setMode('template')}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
              mode === 'template' ? 'bg-accent text-white' : 'text-secondary hover:text-primary'
            }`}
          >
            Vorlage befüllen
          </button>
          <button
            type="button"
            onClick={() => setMode('free')}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
              mode === 'free' ? 'bg-accent text-white' : 'text-secondary hover:text-primary'
            }`}
          >
            Freie Datentabelle
          </button>
        </div>
      </div>

      {mode === 'free' ? <Datentabelle /> : <TabellenTranskription />}
    </>
  );
}
