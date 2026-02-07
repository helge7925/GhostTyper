import Head from 'next/head';
import Navbar from './Navbar';

export default function Layout({ children }) {
  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content="Transkriptions-WebApp mit dynamischer Audio-Analyse" />
        <link rel="icon" href="/favicon.ico" />
        <title>Transkription</title>
      </Head>
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-8">
          {children}
        </main>
        <footer className="border-t border-google-gray-200 py-4 text-center text-xs text-google-gray-500">
          Transkription WebApp
        </footer>
      </div>
    </>
  );
}
