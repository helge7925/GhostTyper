import Link from 'next/link';
import { useRouter } from 'next/router';
import { useSession, signOut } from 'next-auth/react';
import { useState } from 'react';

const NAV_LINKS = [
  { href: '/upload', label: 'Hochladen' },
  { href: '/transcriptions', label: 'Historie' },
  { href: '/settings', label: 'Einstellungen' },
  { href: '/admin/users', label: 'Admin', adminOnly: true },
];

export default function Navbar() {
  const router = useRouter();
  const { data: session } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <nav className="backdrop-blur-xl bg-dark-bg/80 border-b border-white/[0.06] sticky top-0 z-50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
        <Link href="/" className="flex items-center gap-2">
          <svg className="w-7 h-7 text-accent-purple" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 3a1 1 0 0 1 .707.293l7 7a1 1 0 0 1-1.414 1.414L13 6.414V20a1 1 0 1 1-2 0V6.414l-5.293 5.293a1 1 0 0 1-1.414-1.414l7-7A1 1 0 0 1 12 3z" />
          </svg>
          <span className="text-lg font-semibold text-text-primary">GhostTyper</span>
        </Link>

        {session && (
          <div className="hidden md:flex items-center gap-1">
            {NAV_LINKS.filter(link => !link.adminOnly || session.user.role === 'admin').map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={`px-3 py-2 rounded-full text-sm font-medium transition-colors ${
                  router.pathname === href || router.pathname.startsWith(href + '/')
                    ? 'bg-accent-purple/20 text-accent-purple'
                    : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.06]'
                }`}
              >
                {label}
              </Link>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3">
          {session ? (
            <>
              <span className="hidden sm:block text-sm text-text-secondary">
                {session.user.email}
              </span>
              <button
                onClick={() => signOut({ callbackUrl: '/login' })}
                className="text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-white/[0.06] px-3 py-2 rounded-full transition-colors"
              >
                Abmelden
              </button>
            </>
          ) : (
            <Link
              href="/login"
              className="text-sm font-medium gradient-accent text-white px-5 py-2 rounded-full hover:gradient-accent-hover transition-colors"
            >
              Anmelden
            </Link>
          )}

          {/* Mobile hamburger */}
          {session && (
            <button
              className="md:hidden p-2 rounded-full text-text-secondary hover:bg-white/[0.06]"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="Menü"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {menuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Mobile nav */}
      {menuOpen && session && (
        <div className="md:hidden border-t border-white/[0.06] bg-dark-bg/95 backdrop-blur-xl">
          {NAV_LINKS.filter(link => !link.adminOnly || session.user.role === 'admin').map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`block px-6 py-3 text-sm font-medium ${
                router.pathname === href
                  ? 'text-accent-purple bg-accent-purple/10'
                  : 'text-text-secondary hover:bg-white/[0.06]'
              }`}
              onClick={() => setMenuOpen(false)}
            >
              {label}
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}
