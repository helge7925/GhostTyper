import Link from 'next/link';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { Files, Languages, Mic, ScanText, Table } from 'lucide-react';
import { cn } from '../lib/utils';
import { useTranslations } from '../lib/i18n';

/**
 * Bottom navigation for handheld viewports (< md).
 * Top-5 most-used routes; the rest is reachable via the hamburger sheet.
 * Respects iOS safe-area-inset via the trailing pb hack.
 */
// Mirror the desktop sidebar order (Sidebar.js): Transcription →
// Translation → OCR → Tables → Files. The handheld bar drops Text
// Refinement to keep five icons. Remote-Meeting opens via the meeting
// drawer on `/transcriptions?meeting=1` and isn't a separate slot here.
const ITEMS = [
  { href: '/upload', labelKey: 'record', Icon: Mic },
  { href: '/translate', labelKey: 'translate', Icon: Languages },
  { href: '/ocr', labelKey: 'ocr', Icon: ScanText },
  { href: '/tabellen', labelKey: 'tables', Icon: Table },
  { href: '/transcriptions', labelKey: 'files', Icon: Files },
];

export default function BottomNav() {
  const router = useRouter();
  const { data: session } = useSession();
  const t = useTranslations('bottomNav');
  const tNav = useTranslations('nav');

  if (!session) return null;

  return (
    <nav
      className="md:hidden fixed inset-x-0 bottom-0 z-30 border-t border-subtle bg-canvas/90 backdrop-blur-md"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label={tNav('ariaCurrent')}
    >
      <ul className="flex items-stretch justify-around h-14">
        {ITEMS.map(({ href, labelKey, Icon }) => {
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
                <span>{t(labelKey)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
