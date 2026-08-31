import Head from 'next/head';
import Link from 'next/link';
import { useTranslations } from '../lib/i18n';
import { Button } from '../components/ui/button';

export default function Custom404() {
  const t = useTranslations('errors');

  return (
    <>
      <Head>
        <title>{`${t('404.title')} – GhostTyper`}</title>
      </Head>

      <main className="min-h-screen flex items-center justify-center bg-canvas px-6 py-12">
        <section className="w-full max-w-md bg-surface border border-subtle rounded-2xl p-8 text-center shadow-lg">
          <p className="text-7xl font-semibold text-accent-ink tracking-tight">404</p>
          <h1 className="mt-6 text-2xl font-semibold text-primary">{t('404.title')}</h1>
          <p className="mt-3 text-sm leading-6 text-secondary">{t('404.message')}</p>
          <Button asChild variant="primary" size="lg" className="mt-8">
            <Link href="/">{t('404.backHome')}</Link>
          </Button>
        </section>
      </main>
    </>
  );
}
