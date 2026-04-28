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
  const totalInputTokens = usage?.totalInputTokens ?? 0;
  const totalOutputTokens = usage?.totalOutputTokens ?? 0;
  const totalTokens = totalInputTokens + totalOutputTokens;
  const averageCostPerRequest = useMemo(() => {
    const requestCount = usage?.totalRequests ?? 0;
    const totalCost = usage?.totalCost ?? 0;
    if (!requestCount) return 0;
    return totalCost / requestCount;
  }, [usage]);
  const topOperationName = topOperations[0]?.operation || 'Noch keine Daten';

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
            <p className="text-xl text-text-secondary mb-10 leading-relaxed">
              Ihre Gedanken, entschlüsselt und auf den Punkt gebracht.
            </p>
            <Link
              href="/login"
              className="gradient-accent text-white px-8 py-3 rounded-full text-base font-medium hover:gradient-accent-hover transition-all shadow-lg hover:shadow-accent-orange/20"
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
        <section className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-[radial-gradient(circle_at_20%_20%,rgba(0,206,201,0.20),transparent_45%),radial-gradient(circle_at_80%_0%,rgba(255,89,23,0.22),transparent_42%),linear-gradient(145deg,#11131a,#0a0a0f)] p-6 md:p-10">
          <div className="absolute -top-10 -right-8 h-44 w-44 rounded-full bg-accent-cyan/10 blur-2xl animate-pulse" />
          <div className="absolute -bottom-12 -left-6 h-52 w-52 rounded-full bg-accent-orange/10 blur-2xl animate-pulse" />

          <div className="relative">
            <p className="text-[10px] uppercase tracking-[0.22em] text-text-secondary">Dashboard</p>
            <h1 className="mt-2 text-2xl md:text-3xl font-bold text-text-primary">
              Willkommen, {firstName}
            </h1>
            <p className="mt-3 inline-flex items-center rounded-full border border-accent-cyan/30 bg-cyan-500/10 px-3 py-1 text-xs text-accent-cyan">
              {welcomeLine}
            </p>
            <p className="mt-2 text-sm text-text-secondary max-w-2xl">
              Starten Sie direkt mit Transkription, OCR oder Übersetzung.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/upload"
                className="inline-flex items-center gap-2 gradient-accent text-white px-5 py-2.5 rounded-xl text-sm font-semibold shadow-lg shadow-accent-orange/25 hover:scale-[1.01] transition-transform"
              >
                Transkription starten
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </Link>
              <Link
                href="/settings?tab=transcription"
                className="inline-flex items-center gap-2 border border-white/[0.14] text-text-primary px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-white/[0.05] transition-colors"
              >
                Einstellungen
              </Link>
            </div>
          </div>
        </section>

        <section className="mt-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <div className="rounded-2xl border border-white/[0.08] bg-dark-card px-5 py-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">Monatskosten</p>
            <p className="text-xl text-text-primary mt-2">
              {usage?.totalCost?.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }) || '0,00 €'}
            </p>
          </div>
          <div className="rounded-2xl border border-white/[0.08] bg-dark-card px-5 py-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">Requests</p>
            <p className="text-xl text-text-primary mt-2">{usage?.totalRequests ?? 0}</p>
          </div>
          <div className="rounded-2xl border border-white/[0.08] bg-dark-card px-5 py-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">Budgetstatus</p>
            <p className="text-sm mt-2 text-text-primary">
              {usage?.budgetTrafficLight?.label || 'Keine Budgetampel aktiv'}
            </p>
          </div>
          <div className="rounded-2xl border border-white/[0.08] bg-dark-card px-5 py-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">Input-Tokens</p>
            <p className="text-xl text-text-primary mt-2">{totalInputTokens.toLocaleString('de-DE')}</p>
          </div>
          <div className="rounded-2xl border border-white/[0.08] bg-dark-card px-5 py-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">Output-Tokens</p>
            <p className="text-xl text-text-primary mt-2">{totalOutputTokens.toLocaleString('de-DE')}</p>
          </div>
          <div className="rounded-2xl border border-white/[0.08] bg-dark-card px-5 py-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">Gesamt-Tokens</p>
            <p className="text-xl text-text-primary mt-2">{totalTokens.toLocaleString('de-DE')}</p>
          </div>
          <div className="rounded-2xl border border-white/[0.08] bg-dark-card px-5 py-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">Ø Kosten / Request</p>
            <p className="text-xl text-text-primary mt-2">
              {averageCostPerRequest.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
            </p>
          </div>
          <div className="rounded-2xl border border-white/[0.08] bg-dark-card px-5 py-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">Aktivste Operation</p>
            <p className="text-sm text-text-primary mt-2">{topOperationName}</p>
          </div>
          <div className="rounded-2xl border border-white/[0.08] bg-dark-card px-5 py-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">Nutzungsmonat</p>
            <p className="text-sm text-text-primary mt-2">{usage?.month || new Date().toISOString().slice(0, 7)}</p>
          </div>
          <div className="rounded-2xl border border-white/[0.08] bg-dark-card px-5 py-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">Mistral API</p>
            <p className={`text-sm mt-2 ${settingsInfo?.apiKeyConfigured ? 'text-accent-green' : 'text-text-secondary'}`}>
              {settingsInfo?.apiKeyConfigured ? 'Konfiguriert' : 'Nicht konfiguriert'}
            </p>
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-white/[0.08] bg-dark-card px-5 py-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary mb-3">Top Operationen</p>
          <div className="space-y-2">
            {topOperations.map((entry) => (
              <div key={entry.operation} className="flex items-center justify-between text-xs">
                <span className="text-text-primary">{entry.operation}</span>
                <span className="text-text-secondary">
                  {entry.cost.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })} • {entry.requests} Req.
                </span>
              </div>
            ))}
            {topOperations.length === 0 && (
              <p className="text-xs text-text-secondary">Noch keine Nutzungsdaten vorhanden.</p>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
