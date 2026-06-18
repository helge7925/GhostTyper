import Head from 'next/head';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import LoadingSpinner from '../components/LoadingSpinner';
import { useMessageList, useTranslations } from '../lib/i18n';

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
  const tAuth = useTranslations('auth');
  const tLanding = useTranslations('landing');
  const welcomeMessages = useMessageList('loadingMessages.welcome');
  const [welcomeLine, setWelcomeLine] = useState('');

  useEffect(() => {
    if (status !== 'authenticated' || welcomeMessages.length === 0) return undefined;
    setWelcomeLine((previous) => pickRandomLine(welcomeMessages, previous));
    const timer = setInterval(() => {
      setWelcomeLine((previous) => pickRandomLine(welcomeMessages, previous));
    }, 12000);
    return () => clearInterval(timer);
  }, [status, welcomeMessages]);

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

  const firstName = getFirstName(session);

  return (
    <>
      <Head>
        <title>Dashboard - GhostTyper</title>
      </Head>

      <div className="min-h-[72vh] flex flex-col items-center justify-center text-center animate-fade-in px-4">
        <p className="text-[11px] uppercase tracking-[0.32em] text-info/70 mb-5">
          {tLanding('decoded')}
        </p>
        <h1 className="text-3xl md:text-5xl font-bold tracking-tight text-primary">
          {tLanding('title')}, {firstName}
        </h1>
        <p
          key={welcomeLine}
          className="mt-7 max-w-2xl text-lg md:text-2xl font-medium leading-snug text-secondary animate-fade-in"
        >
          {welcomeLine}
        </p>
      </div>
    </>
  );
}
