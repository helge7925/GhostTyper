import Head from 'next/head';
import { useSession } from 'next-auth/react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import BottomNav from './BottomNav';
import { useTheme } from '../lib/theme-context';
import { useUIStore } from '../lib/store/ui-store';
import { useTranslations } from '../lib/i18n';
import { cn } from './../lib/utils';

export default function Layout({ children }) {
  const { data: session } = useSession();
  const { resolvedTheme } = useTheme();
  const { sidebarCollapsed } = useUIStore();
  const tFooter = useTranslations('layout');

  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="description" content="Audio-Transkription und KI-Analyse" />
        <meta
          name="theme-color"
          content={resolvedTheme === 'dark' ? '#0a0a0f' : '#fafafa'}
        />
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <meta name="mobile-web-app-capable" content="yes" />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" type="image/png" href="/logo.png" />
        <title>GhostTyper</title>
      </Head>

      <div className="min-h-screen bg-canvas">
        {session ? (
          <>
            <Sidebar />

            <div
              className={cn(
                'flex flex-col min-h-screen transition-[padding] duration-200',
                sidebarCollapsed ? 'xl:pl-16' : 'xl:pl-64',
              )}
            >
              <TopBar />

              <main
                className="flex-1 w-full px-4 sm:px-6 py-6"
                style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 5rem)' }}
              >
                {children}
              </main>

              <footer className="py-8 text-center space-y-1 md:pb-8">
                <p className="text-[10px] text-secondary/60 uppercase tracking-[0.2em]">
                  {tFooter('footerTagline')}
                </p>
                <p className="text-[10px] text-secondary/40 uppercase tracking-widest">
                  {tFooter('footerCredit')}
                </p>
              </footer>
            </div>

            <BottomNav />
          </>
        ) : (
          <div className="flex flex-col min-h-screen">
            <TopBar />
            <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-8">
              {children}
            </main>
            <footer className="py-12 text-center space-y-2">
              <p className="text-xs text-secondary/60 uppercase tracking-[0.2em]">
                {tFooter('footerTagline')}
              </p>
              <p className="text-xs text-secondary/40 uppercase tracking-widest">
                {tFooter('footerCredit')}
              </p>
            </footer>
          </div>
        )}
      </div>
    </>
  );
}
