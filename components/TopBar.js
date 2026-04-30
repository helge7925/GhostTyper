import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import {
  ChevronsLeft,
  ChevronsRight,
  LogOut,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  User,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import ThemeToggle from './ThemeToggle';
import { useUIStore } from '../lib/store/ui-store';

function isMacLike() {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');
}

function ProfileMenu({ session }) {
  const initials = session.user.email?.substring(0, 2)?.toUpperCase() || '??';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-xl p-1 hover:bg-hover-subtle transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label="Benutzermenü"
        >
          {session.user.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={session.user.avatar_url}
              alt=""
              className="w-8 h-8 rounded-full object-cover border border-subtle"
            />
          ) : (
            <span className="w-8 h-8 rounded-full gradient-accent flex items-center justify-center text-xs font-bold text-white shadow-lg shadow-accent/20">
              {initials}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-primary normal-case tracking-normal">
              {session.user.name || 'Benutzer'}
            </span>
            <span className="text-[11px] text-secondary normal-case tracking-normal">
              {session.user.email}
            </span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/profile">
            <User aria-hidden="true" className="w-4 h-4" />
            Profil
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings aria-hidden="true" className="w-4 h-4" />
            Einstellungen
          </Link>
        </DropdownMenuItem>
        {session.user.role === 'admin' && (
          <DropdownMenuItem asChild>
            <Link href="/admin/users">
              <ShieldCheck aria-hidden="true" className="w-4 h-4" />
              Admin
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            signOut({ callbackUrl: '/login' });
          }}
          className="text-danger data-[highlighted]:bg-danger/10 data-[highlighted]:text-danger"
        >
          <LogOut aria-hidden="true" className="w-4 h-4" />
          Abmelden
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function TopBar() {
  const router = useRouter();
  const { data: session } = useSession();
  const { openSidebar, toggleSidebarCollapsed, sidebarCollapsed, openCommandPalette } = useUIStore();
  const [shortcutKey, setShortcutKey] = useState('Ctrl');

  useEffect(() => {
    setShortcutKey(isMacLike() ? '⌘' : 'Ctrl');
  }, []);

  // Unauthenticated: minimal bar with logo + theme toggle.
  if (!session) {
    return (
      <header
        className="sticky top-0 z-30 h-14 flex items-center justify-between gap-2 px-4 border-b border-subtle bg-canvas/85 backdrop-blur-md"
        role="banner"
      >
        <Link href="/" className="flex items-center gap-2 min-w-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" width={26} height={26} className="w-6 h-6" />
          <span className="font-bold text-primary tracking-tight truncate">GhostTyper</span>
        </Link>
        <ThemeToggle compact />
      </header>
    );
  }

  return (
    <header
      className="sticky top-0 z-30 h-14 flex items-center gap-2 px-3 sm:px-4 border-b border-subtle bg-canvas/85 backdrop-blur-md"
      role="banner"
    >
      {/* Left: Hamburger (mobile/tablet) | Sidebar collapse toggle (desktop) */}
      <button
        type="button"
        onClick={openSidebar}
        className="xl:hidden inline-flex items-center justify-center w-10 h-10 rounded-lg text-secondary hover:text-primary hover:bg-hover-subtle transition-colors"
        aria-label="Navigation öffnen"
      >
        <Menu className="w-5 h-5" aria-hidden="true" />
      </button>

      <button
        type="button"
        onClick={toggleSidebarCollapsed}
        className="hidden xl:inline-flex items-center justify-center w-10 h-10 rounded-lg text-secondary hover:text-primary hover:bg-hover-subtle transition-colors"
        aria-label={sidebarCollapsed ? 'Seitenleiste ausklappen' : 'Seitenleiste einklappen'}
      >
        {sidebarCollapsed ? (
          <ChevronsRight className="w-5 h-5" aria-hidden="true" />
        ) : (
          <ChevronsLeft className="w-5 h-5" aria-hidden="true" />
        )}
      </button>

      {/* Logo (mobile/tablet only — desktop has it in the persistent sidebar) */}
      <Link href="/" className="xl:hidden flex items-center gap-2 min-w-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="" width={26} height={26} className="w-6 h-6" />
        <span className="font-bold text-primary tracking-tight truncate">GhostTyper</span>
      </Link>

      {/* Center: Command palette trigger (tablet+ only — mobile gets icon-only) */}
      <button
        type="button"
        onClick={openCommandPalette}
        className="hidden md:inline-flex flex-1 items-center gap-2 max-w-md mx-auto h-9 rounded-xl border border-subtle bg-surface px-3 text-sm text-secondary hover:text-primary hover:bg-hover-subtle transition-colors"
        aria-label="Suche und Befehlspalette öffnen"
      >
        <Search className="w-4 h-4" aria-hidden="true" />
        <span className="flex-1 text-left">Suche oder Befehl…</span>
        <kbd className="text-[10px] font-semibold tracking-wider text-secondary border border-subtle rounded px-1.5 py-0.5">
          {shortcutKey} K
        </kbd>
      </button>

      <div className="flex-1 md:hidden" />

      {/* Right: Mobile search icon, theme toggle, profile menu */}
      <button
        type="button"
        onClick={openCommandPalette}
        className="md:hidden inline-flex items-center justify-center w-10 h-10 rounded-lg text-secondary hover:text-primary hover:bg-hover-subtle transition-colors"
        aria-label="Suche öffnen"
      >
        <Search className="w-5 h-5" aria-hidden="true" />
      </button>

      <ThemeToggle compact />

      <ProfileMenu session={session} />
    </header>
  );
}
