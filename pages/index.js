import Head from 'next/head';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useEffect, useMemo, useState } from 'react';
import LoadingSpinner from '../components/LoadingSpinner';

const WELCOME_LINES = [
  'Kleiner Reminder: Auch Genies dürfen Copy-Paste benutzen.',
  'Heute wird produktiv gearbeitet, aber mit Stil und ohne Stress.',
  'Ihre Ideen sind bereit. Der Text-Turbo läuft schon warm.',
  'Plan für heute: Weniger Chaos, mehr Klartext.',
  'Wenn Wörter rennen, stellen wir sie in geordnete Reihen.',
  'Ein guter Tag, um aus Notizen Ergebnisse zu machen.',
];

const FEATURE_SUMMARIES = [
  {
    href: '/upload',
    title: 'Transkription',
    description: 'Audio hochladen oder aufnehmen und daraus ein Transkript mit optionaler Analyse erstellen.',
  },
  {
    href: '/tabellen?mode=template',
    title: 'Tabellen',
    description: 'Entweder eine feste Tabellen-Vorlage aus einem Transkript befüllen oder eine freie Datentabelle aus Text, Audio oder OCR erzeugen.',
  },
  {
    href: '/translate',
    title: 'Übersetzung',
    description: 'Text direkt übersetzen, PDF/Bilder per OCR übernehmen oder DOCX, XLSX und PPTX mit erhaltener Office-Struktur übersetzen.',
  },
  {
    href: '/ocr',
    title: 'OCR',
    description: 'PDFs und Bilder in Text umwandeln und bei Bedarf direkt analysieren oder als Tabelleninhalt strukturieren.',
  },
  {
    href: '/textoptimierung',
    title: 'Textoptimierung',
    description: 'E-Mails und andere Texte korrigieren, kürzen oder formeller, freundlicher und klarer formulieren.',
  },
  {
    href: '/transcriptions',
    title: 'Historie & Export',
    description: 'Verarbeitete Dateien wiederfinden, nach Ordnern organisieren und Ergebnisse als PDF, DOCX oder Excel exportieren.',
  },
];

function pickWelcomeLine(previousLine) {
  const candidates = WELCOME_LINES.filter((line) => line !== previousLine);
  const pool = candidates.length > 0 ? candidates : WELCOME_LINES;
  const index = Math.floor(Math.random() * pool.length);
  return pool[index];
}

function getFirstName(session) {
  const rawName = String(session?.user?.name || '').trim();
  if (rawName) return rawName.split(/\s+/)[0];

  const email = String(session?.user?.email || '').trim();
  if (email.includes('@')) {
    const local = email.split('@')[0];
    const cleaned = local.replace(/[._-]+/g, ' ').trim();
    if (cleaned) {
      const first = cleaned.split(/\s+/)[0];
      return first.charAt(0).toUpperCase() + first.slice(1);
    }
  }

  return 'da';
}

export default function Home() {
  const { data: session, status } = useSession();
  const [usage, setUsage] = useState(null);
  const [settingsInfo, setSettingsInfo] = useState(null);
  const [welcomeLine, setWelcomeLine] = useState(WELCOME_LINES[0]);

  useEffect(() => {
    if (status !== 'authenticated') return;

    fetch('/api/usage')
      .then((response) => (response.ok ? response.json() : null))
      .then((usageData) => {
        setUsage(usageData);
      })
      .catch(() => {});

    fetch('/api/settings')
      .then((response) => (response.ok ? response.json() : null))
      .then((settingsData) => {
        setSettingsInfo(settingsData);
      })
      .catch(() => {});

    setWelcomeLine((previous) => pickWelcomeLine(previous));
    const timer = setInterval(() => {
      setWelcomeLine((previous) => pickWelcomeLine(previous));
    }, 12000);

    return () => clearInterval(timer);
  }, [status]);

  const topOperations = useMemo(
    () => (usage?.byOperation || []).slice(0, 3),
    [usage]
  );
  const firstName = useMemo(() => getFirstName(session), [session]);

  if (status === 'loading') {
    return <LoadingSpinner />;
  }

  if (status === 'unauthenticated') {
    return (
      <>
        <Head>
          <title>GhostTyper</title>
        </Head>

        <div className="min-h-[70vh] flex items-center justify-center">
          <div className="text-center max-w-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo-text.png"
              alt="GhostTyper"
              width={240}
              height={64}
              className="h-16 w-auto mx-auto mb-6"
            />
            <p className="text-xl text-secondary mb-10 leading-relaxed">
              Ihre Gedanken, entschlüsselt und auf den Punkt gebracht.
            </p>
            <Link
              href="/login"
              className="gradient-accent text-white px-8 py-3 rounded-full text-base font-medium hover:gradient-accent-hover transition-all shadow-lg hover:shadow-accent/20"
            >
              Jetzt starten
            </Link>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>Dashboard - GhostTyper</title>
      </Head>

      <div className="mx-auto max-w-6xl animate-fade-in pb-20">
        <section className="rounded-2xl border border-subtle bg-surface p-6 md:p-10">
          <div>
            <p className="text-[10px] uppercase tracking-[0.22em] text-secondary">Dashboard</p>
            <h1 className="mt-2 text-2xl md:text-3xl font-bold text-primary">
              Willkommen, {firstName}
            </h1>
            <div className="mt-6 rounded-2xl border border-info/20 bg-cyan-500/[0.06] px-5 py-4 md:px-6 md:py-5">
              <p className="text-[10px] uppercase tracking-[0.22em] text-info/80">Heute im Kopf</p>
              <p className="mt-2 text-lg md:text-2xl font-semibold leading-snug text-primary">
                {welcomeLine}
              </p>
            </div>
          </div>
        </section>

        <section className="mt-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {FEATURE_SUMMARIES.map((feature) => (
            <Link
              key={feature.href}
              href={feature.href}
              className="rounded-2xl border border-subtle bg-surface px-5 py-4 hover:border-accent/30 transition-colors"
            >
              <h2 className="text-sm font-semibold text-primary">{feature.title}</h2>
              <p className="text-xs text-secondary mt-2 leading-relaxed">{feature.description}</p>
            </Link>
          ))}
        </section>

        <section className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-subtle bg-surface px-5 py-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-secondary">Monatskosten</p>
            <p className="text-xl text-primary mt-2">
              {usage?.totalCost?.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }) || '0,00 €'}
            </p>
          </div>
          <div className="rounded-2xl border border-subtle bg-surface px-5 py-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-secondary">Mistral API</p>
            <p className={`text-sm mt-2 ${settingsInfo?.apiKeyConfigured ? 'text-success' : 'text-secondary'}`}>
              {settingsInfo?.apiKeyConfigured ? 'Konfiguriert' : 'Nicht konfiguriert'}
            </p>
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-subtle bg-surface px-5 py-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-secondary mb-3">Top Operationen</p>
          <div className="space-y-2">
            {topOperations.map((entry) => (
              <div key={entry.operation} className="flex items-center justify-between text-xs">
                <span className="text-primary">{entry.operation}</span>
                <span className="text-secondary">
                  {entry.cost.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                </span>
              </div>
            ))}
            {topOperations.length === 0 && (
              <p className="text-xs text-secondary">Noch keine Nutzungsdaten vorhanden.</p>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
