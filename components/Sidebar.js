import Link from 'next/link';
import { useRouter } from 'next/router';
import { useSession, signOut } from 'next-auth/react';
import { useState, useEffect, useRef } from 'react';

const NAV_LINKS = [
  { 
    href: '/upload', 
    label: 'Transkription', 
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
      </svg>
    )
  },
  { 
    href: '/translate', 
    label: 'Übersetzung', 
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
      </svg>
    )
  },
  { 
    href: '/ocr', 
    label: 'OCR', 
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    )
  },
  {
    href: '/datentabelle',
    label: 'Datentabelle',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7h18M3 12h18M3 17h18M6 4v16M12 4v16M18 4v16" />
      </svg>
    )
  },
  { 
    href: '/transcriptions', 
    label: 'Historie', 
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    )
  },
];

export default function Sidebar({ isOpen, setIsOpen }) {
  const router = useRouter();
  const { data: session } = useSession();
  const touchStartX = useRef(null);
  const touchStartY = useRef(null);
  const trackingGesture = useRef(false);

  useEffect(() => {
    const isMobileViewport = () => window.innerWidth < 768;

    const handleTouchStart = (e) => {
      if (!isMobileViewport()) return;
      const touch = e.touches[0];
      if (!touch) return;

      const startX = touch.clientX;
      const startY = touch.clientY;
      const edgeOpenZone = !isOpen && startX <= 24;
      const sidebarCloseZone = isOpen && startX <= 280;

      if (!edgeOpenZone && !sidebarCloseZone) {
        trackingGesture.current = false;
        return;
      }

      trackingGesture.current = true;
      touchStartX.current = startX;
      touchStartY.current = startY;
    };

    const handleTouchMove = (e) => {
      if (!trackingGesture.current || touchStartX.current === null || touchStartY.current === null) return;
      const touch = e.touches[0];
      if (!touch) return;

      const diffX = touch.clientX - touchStartX.current;
      const diffY = Math.abs(touch.clientY - touchStartY.current);
      if (diffY > Math.abs(diffX)) return;

      // Swipe right to open
      if (diffX > 60 && !isOpen) {
        setIsOpen(true);
        trackingGesture.current = false;
      }
      // Swipe left to close
      if (diffX < -60 && isOpen) {
        setIsOpen(false);
        trackingGesture.current = false;
      }
    };

    const handleTouchEnd = () => {
      touchStartX.current = null;
      touchStartY.current = null;
      trackingGesture.current = false;
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isOpen, setIsOpen]);

  if (!session) return null;

  return (
    <>
      {/* Mobile Overlay */}
      <div 
        className={`fixed inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity duration-300 md:hidden ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setIsOpen(false)}
      />

      {/* Sidebar */}
      <aside 
        className={`fixed inset-y-0 left-0 w-64 bg-dark-bg border-r border-white/[0.06] z-50 transform transition-transform duration-300 ease-in-out md:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        } flex flex-col`}
      >
        {/* Logo Section */}
        <div className="p-6">
          <Link href="/" className="flex items-center gap-3" onClick={() => setIsOpen(false)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.png"
              alt="GhostTyper Logo"
              width={32}
              height={32}
              className="w-8 h-8"
            />
            <span className="text-xl font-bold tracking-tight text-text-primary">GhostTyper</span>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto scrollbar-hide">
          {NAV_LINKS.filter(link => !link.adminOnly || session.user.role === 'admin').map((link) => {
            const isActive = router.pathname === link.href || router.pathname.startsWith(link.href + '/');
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setIsOpen(false)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-accent-orange/10 text-accent-orange'
                    : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.04]'
                }`}
              >
                <span className={isActive ? 'text-accent-orange' : 'text-text-secondary'}>
                  {link.icon}
                </span>
                {link.label}
              </Link>
            );
          })}
        </nav>

        {/* User / Bottom Section */}
        <div className="p-4 mt-auto border-t border-white/[0.06] space-y-1">
          {/* Settings Link */}
          <Link
            href="/settings"
            onClick={() => setIsOpen(false)}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
              router.pathname === '/settings'
                ? 'bg-white/[0.06] text-text-primary'
                : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.04]'
            }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Einstellungen
          </Link>

          {session.user.role === 'admin' && (
            <Link
              href="/admin/users"
              onClick={() => setIsOpen(false)}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                router.pathname.startsWith('/admin')
                  ? 'bg-white/[0.06] text-text-primary'
                  : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.04]'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              Admin
            </Link>
          )}

          {/* Profile Section */}
          <Link 
            href="/profile"
            onClick={() => setIsOpen(false)}
            className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-white/[0.04] transition-all group"
          >
            {session.user.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img 
                src={session.user.avatar_url} 
                alt="Profil" 
                className="w-8 h-8 rounded-full object-cover border border-white/10"
              />
            ) : (
              <div className="w-8 h-8 rounded-full gradient-accent flex items-center justify-center text-xs font-bold text-white uppercase shadow-lg shadow-accent-orange/20 group-hover:scale-105 transition-transform">
                {session.user.email?.substring(0, 2)}
              </div>
            )}
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-medium text-text-primary truncate group-hover:text-accent-orange transition-colors">
                {session.user.name || 'Benutzer'}
              </span>
              <span className="text-[10px] text-text-secondary truncate">
                {session.user.email}
              </span>
            </div>
          </Link>
          
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-sm font-medium text-text-secondary hover:text-accent-red hover:bg-accent-red/10 transition-all"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Abmelden
          </button>
        </div>
      </aside>
    </>
  );
}
