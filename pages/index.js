import Head from 'next/head';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useEffect, useMemo, useState } from 'react';
import LoadingSpinner from '../components/LoadingSpinner';
import { useFormatter, useMessageList, useTranslations } from '../lib/i18n';

// Locale-independent route metadata for the dashboard tile grid; the
// title/description are looked up via i18n at render time.
const FEATURE_TILES = [
  { href: '/upload', titleKey: 'transcription' },
  { href: '/tabellen?mode=template', titleKey: 'tables' },
  { href: '/translate', titleKey: 'translation' },
  { href: '/ocr', titleKey: 'ocr' },
  { href: '/textoptimierung', titleKey: 'textOptimization' },
  { href: '/transcriptions', titleKey: 'history' },
];

function pickRandomLine(pool, previousLine) {
  if (!Array.isArray(pool) || pool.length === 0) return previousLine || '';
  const candidates = pool.filter((line) => line !== previousLine);
  const choice = candidates.length > 0 ? candidates : pool;
  return choice[Math.floor(Math.random() * choice.length)];
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
  const tAuth = useTranslations('auth');
  const tLanding = useTranslations('landing');
  const tNav = useTranslations('nav');
  const tUsage = useTranslations('organization.usage');
  const { currency } = useFormatter();
  const welcomeMessages = useMessageList('loadingMessages.welcome');
  const [welcomeLine, setWelcomeLine] = useState('');

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
  }, [status]);

  useEffect(() => {
    if (status !== 'authenticated' || welcomeMessages.length === 0) return undefined;
    setWelcomeLine((previous) => pickRandomLine(welcomeMessages, previous));
    const timer = setInterval(() => {
      setWelcomeLine((previous) => pickRandomLine(welcomeMessages, previous));
    }, 12000);
    return () => clearInterval(timer);
  }, [status, welcomeMessages]);

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
            <p className="text-xl text-secondary mb-10 leading-relaxed">{tAuth('tagline')}</p>
            <Link
              href="/login"
              className="gradient-accent text-white px-8 py-3 rounded-full text-base font-medium hover:gradient-accent-hover transition-all shadow-lg hover:shadow-accent/20"
            >
              {tLanding('ctaStart')}
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
              {tLanding('title')}, {firstName}
            </h1>
            <div className="mt-6 rounded-2xl border border-info/20 bg-cyan-500/[0.06] px-5 py-4 md:px-6 md:py-5">
              <p className="text-[10px] uppercase tracking-[0.22em] text-info/80">{tLanding('decoded')}</p>
              <p className="mt-2 text-lg md:text-2xl font-semibold leading-snug text-primary">
                {welcomeLine}
              </p>
            </div>
          </div>
        </section>

        <section className="mt-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {FEATURE_TILES.map((tile) => (
            <Link
              key={tile.href}
              href={tile.href}
              className="rounded-2xl border border-subtle bg-surface px-5 py-4 hover:border-accent/30 transition-colors"
            >
              <h2 className="text-sm font-semibold text-primary">{tNav(tile.titleKey)}</h2>
            </Link>
          ))}
        </section>

        <section className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-subtle bg-surface px-5 py-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-secondary">{tUsage('totalCost')}</p>
            <p className="text-xl text-primary mt-2">
              {usage?.totalCost != null ? currency.format(usage.totalCost) : currency.format(0)}
            </p>
          </div>
          <div className="rounded-2xl border border-subtle bg-surface px-5 py-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-secondary">Mistral API</p>
            <p className={`text-sm mt-2 ${settingsInfo?.apiKeyConfigured ? 'text-success' : 'text-secondary'}`}>
              {settingsInfo?.apiKeyConfigured ? '✓' : '—'}
            </p>
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-subtle bg-surface px-5 py-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-secondary mb-3">{tUsage('byOperation')}</p>
          <div className="space-y-2">
            {topOperations.map((entry) => (
              <div key={entry.operation} className="flex items-center justify-between text-xs">
                <span className="text-primary">{entry.operation}</span>
                <span className="text-secondary">{currency.format(entry.cost)}</span>
              </div>
            ))}
            {topOperations.length === 0 && (
              <p className="text-xs text-secondary">{tUsage('noActivity')}</p>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
