import { SessionProvider } from 'next-auth/react';
import '../styles/globals.css';
import Layout from '../components/Layout';
import ErrorBoundary from '../components/ErrorBoundary';

export default function App({ Component, pageProps: { session, ...pageProps } }) {
  return (
    <SessionProvider session={session}>
      <ErrorBoundary>
        <Layout>
          <Component {...pageProps} />
        </Layout>
      </ErrorBoundary>
    </SessionProvider>
  );
}
