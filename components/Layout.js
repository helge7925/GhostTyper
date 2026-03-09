import Head from 'next/head';
import Sidebar from './Sidebar';
import { useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';

export default function Layout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { data: session } = useSession();

  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content="Audio-Transkription und KI-Analyse" />
        <meta name="theme-color" content="#0a0a0f" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <meta name="mobile-web-app-capable" content="yes" />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" type="image/png" href="/logo.png" />
        <title>GhostTyper</title>
      </Head>
      
      <div className="min-h-screen bg-dark-bg flex flex-col md:flex-row">
        {session && (
          <>
            {/* Mobile Header */}
            <header className="md:hidden flex items-center justify-between px-4 h-16 border-b border-white/[0.06] bg-dark-bg sticky top-0 z-30">
              <button 
                onClick={() => setSidebarOpen(true)}
                className="p-2 -ml-2 text-text-secondary hover:text-text-primary transition-colors"
                aria-label="Menü öffnen"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              
              <Link href="/" className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/logo.png"
                  alt="GhostTyper"
                  width={28}
                  height={28}
                  className="w-7 h-7"
                />
                <span className="font-bold text-text-primary tracking-tight">GhostTyper</span>
              </Link>
              
              <div className="w-10" /> {/* Spacer for centering */}
            </header>

            <Sidebar isOpen={sidebarOpen} setIsOpen={setSidebarOpen} />
          </>
        )}

        <div className={`flex-1 flex flex-col min-w-0 ${session ? 'md:pl-64' : ''}`}>
          <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-8">
            {children}
          </main>
          
          <footer className="py-12 text-center space-y-2">
            <p className="text-xs text-text-secondary/60 uppercase tracking-[0.2em]">
              Your thoughts, decoded and distilled.
            </p>
            <p className="text-xs text-text-secondary/40 uppercase tracking-widest">
              Ghost Typer 2026 &bull; Developed by Helge Roos
            </p>
          </footer>
        </div>
      </div>
    </>
  );
}
