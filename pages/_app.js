import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { SessionProvider } from 'next-auth/react';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import '../styles/globals.css';
import Layout from '../components/Layout';
import ErrorBoundary from '../components/ErrorBoundary';
import CommandPalette from '../components/CommandPalette';
import { ThemeProvider } from '../lib/theme-context';
import { Toaster } from '../components/ui/sonner';
import { useUIStore } from '../lib/store/ui-store';
import { I18nProvider, readLocaleFromCookie, DEFAULT_LOCALE } from '../lib/i18n';

/**
 * Routes that opt out of the standard app shell (TopBar/Sidebar/BottomNav).
 * Editor pages take the entire viewport and supply their own slim header.
 */
const NO_LAYOUT_ROUTES = new Set([
  '/transcriptions/[id]/edit',
  '/transcriptions/[id]/table',
  // Public share-link companion view — visitors aren't necessarily
  // logged in, so the GhostTyper sidebar/topbar would 404 on its
  // session-dependent calls and create a confusing first impression.
  '/share/[token]',
]);

function isEditableTarget(target) {
  if (!target || target.nodeType !== 1) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function GlobalShortcuts() {
  const toggleCommandPalette = useUIStore((s) => s.toggleCommandPalette);
  const openCommandPalette = useUIStore((s) => s.openCommandPalette);

  useEffect(() => {
    const handler = (event) => {
      // ⌘K / Ctrl+K — toggle command palette anywhere.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        toggleCommandPalette();
        return;
      }
      // "/" — open palette when typing in an empty area (not inside a field).
      if (event.key === '/' && !isEditableTarget(event.target)) {
        event.preventDefault();
        openCommandPalette();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleCommandPalette, openCommandPalette]);

  return null;
}

function AppBody({ Component, pageProps }) {
  const router = useRouter();
  const useLayout = !NO_LAYOUT_ROUTES.has(router.route);

  if (!useLayout) {
    return <Component {...pageProps} />;
  }
  return (
    <Layout>
      <Component {...pageProps} />
    </Layout>
  );
}

function App({ Component, pageProps: { session, initialLocale, ...pageProps } }) {
  return (
    <SessionProvider session={session}>
      <I18nProvider initialLocale={initialLocale || DEFAULT_LOCALE}>
        <ThemeProvider>
          <TooltipProvider delayDuration={250}>
            <ErrorBoundary>
              <AppBody Component={Component} pageProps={pageProps} />
            </ErrorBoundary>
            <GlobalShortcuts />
            <CommandPalette />
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </I18nProvider>
    </SessionProvider>
  );
}

App.getInitialProps = async (appCtx) => {
  // Read the locale cookie server-side so the first paint matches the
  // user's choice (no client-side flash to default → user locale).
  const cookieHeader = appCtx?.ctx?.req?.headers?.cookie || '';
  const initialLocale = readLocaleFromCookie(cookieHeader) || DEFAULT_LOCALE;
  return { pageProps: { initialLocale } };
};

export default App;
