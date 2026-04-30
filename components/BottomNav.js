import Link from 'next/link';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { History, Languages, Mic, ScanText, Table } from 'lucide-react';
import { cn } from '../lib/utils';

/**
 * Bottom navigation for handheld viewports (< md).
 * Top-5 most-used routes; the rest is reachable via the hamburger sheet.
 * Respects iOS safe-area-inset via the trailing pb hack.
 */
const ITEMS = [
  { href: '/upload', label: 'Aufnahme', Icon: Mic },
  { href: '/tabellen', label: 'Tabellen', Icon: Table },
  { href: '/translate', label: 'Übersetzen', Icon: Languages },
  { href: '/ocr', label: 'OCR', Icon: ScanText },
  { href: '/transcriptions', label: 'Historie', Icon: History },
];

export default function BottomNav() {
  const router = useRouter();
  const { data: session } = useSession();

  if (!session) return null;

  return (
    <nav
      className="md:hidden fixed inset-x-0 bottom-0 z-30 border-t border-subtle bg-canvas/90 backdrop-blur-md"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Hauptnavigation"
    >
      <ul className="flex items-stretch justify-around h-14">
        {ITEMS.map(({ href, label, Icon }) => {
          const isActive = router.pathname === href || router.pathname.startsWith(href + '/');
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center justify-center gap-0.5 h-full text-[10px] font-medium transition-colors',
                  isActive ? 'text-accent' : 'text-secondary hover:text-primary',
                )}
              >
                <Icon className="w-5 h-5" aria-hidden="true" />
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
