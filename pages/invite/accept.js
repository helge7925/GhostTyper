import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { CheckCircle2, AlertTriangle, LogIn } from 'lucide-react';
import LoadingSpinner from '../../components/LoadingSpinner';
import { Button } from '../../components/ui/button';
import { useTranslations } from '../../lib/i18n';

const STATES = {
  IDLE: 'idle',
  ACCEPTING: 'accepting',
  SUCCESS: 'success',
  ERROR: 'error',
};

export default function AcceptInvitePage() {
  const router = useRouter();
  const { data: session, status, update } = useSession();
  const tokenFromQuery = typeof router.query.token === 'string' ? router.query.token : null;
  const [state, setState] = useState(STATES.IDLE);
  const [error, setError] = useState(null);
  const [accepted, setAccepted] = useState(null);
  const t = useTranslations('invite');
  const tCommon = useTranslations('common');
  const tErrors = useTranslations('errors');

  useEffect(() => {
    if (status !== 'authenticated' || !tokenFromQuery || state !== STATES.IDLE) return;
    let cancelled = false;
    (async () => {
      setState(STATES.ACCEPTING);
      try {
        const response = await fetch('/api/organizations/invites/accept', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: tokenFromQuery }),
        });
        const payload = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) {
          setError(payload?.message || tCommon('error'));
          setState(STATES.ERROR);
          return;
        }
        setAccepted(payload);
        if (typeof update === 'function' && payload?.switchTo) {
          await update({ currentOrganizationId: payload.switchTo });
        }
        setState(STATES.SUCCESS);
      } catch (err) {
        if (cancelled) return;
        setError(err?.message || tErrors('connection'));
        setState(STATES.ERROR);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, tokenFromQuery, state, update]);

  if (status === 'loading') {
    return <LoadingSpinner />;
  }

  const pageTitle = `${t('title')} – GhostTyper`;

  if (status === 'unauthenticated') {
    const next = encodeURIComponent(router.asPath || '/invite/accept');
    return (
      <>
        <Head>
          <title>{pageTitle}</title>
        </Head>
        <main className="max-w-lg mx-auto py-16 px-4 text-center space-y-4">
          <LogIn className="w-10 h-10 text-accent mx-auto" aria-hidden="true" />
          <h1 className="text-xl font-semibold text-primary">{tCommon('loginRequired')}</h1>
          <p className="text-sm text-secondary">{t('loginNeeded')}</p>
          <Button asChild>
            <Link href={`/login?next=${next}`}>{t('loginCta')}</Link>
          </Button>
        </main>
      </>
    );
  }

  if (!tokenFromQuery) {
    return (
      <>
        <Head>
          <title>{pageTitle}</title>
        </Head>
        <main className="max-w-lg mx-auto py-16 px-4 text-center space-y-3">
          <AlertTriangle className="w-10 h-10 text-warning mx-auto" aria-hidden="true" />
          <h1 className="text-xl font-semibold text-primary">{t('noToken')}</h1>
          <p className="text-sm text-secondary">{t('noTokenHint')}</p>
        </main>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>{pageTitle}</title>
      </Head>
      <main className="max-w-lg mx-auto py-16 px-4 text-center space-y-4">
        {(state === STATES.IDLE || state === STATES.ACCEPTING) && (
          <>
            <LoadingSpinner />
            <p className="text-sm text-secondary">{t('accepting')}</p>
          </>
        )}
        {state === STATES.SUCCESS && (
          <>
            <CheckCircle2 className="w-10 h-10 text-success mx-auto" aria-hidden="true" />
            <h1 className="text-xl font-semibold text-primary">{t('successTitle')}</h1>
            <p className="text-sm text-secondary">
              {t('successMessage', { role: accepted?.role || t('successFallbackRole') })}
            </p>
            <div className="flex justify-center gap-3 pt-2">
              <Button asChild>
                <Link href="/upload">{t('ctaStart')}</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/settings/organization">{t('ctaWorkspace')}</Link>
              </Button>
            </div>
          </>
        )}
        {state === STATES.ERROR && (
          <>
            <AlertTriangle className="w-10 h-10 text-danger mx-auto" aria-hidden="true" />
            <h1 className="text-xl font-semibold text-primary">{t('errorTitle')}</h1>
            <p className="text-sm text-secondary">{error}</p>
            <Button asChild variant="outline">
              <Link href="/">{t('errorBackHome')}</Link>
            </Button>
          </>
        )}
      </main>
    </>
  );
}
