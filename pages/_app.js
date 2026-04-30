import { useEffect } from 'react';
import { SessionProvider } from 'next-auth/react';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import '../styles/globals.css';
import Layout from '../components/Layout';
import ErrorBoundary from '../components/ErrorBoundary';
import CommandPalette from '../components/CommandPalette';
import { ThemeProvider } from '../lib/theme-context';
import { Toaster } from '../components/ui/sonner';
import { useUIStore } from '../lib/store/ui-store';

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

export default function App({ Component, pageProps: { session, ...pageProps } }) {
  return (
    <SessionProvider session={session}>
      <ThemeProvider>
        <TooltipProvider delayDuration={250}>
          <ErrorBoundary>
            <Layout>
              <Component {...pageProps} />
            </Layout>
          </ErrorBoundary>
          <GlobalShortcuts />
          <CommandPalette />
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
