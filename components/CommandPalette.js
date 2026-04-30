import { useRouter } from 'next/router';
import { useSession, signOut } from 'next-auth/react';
import {
  History,
  Languages,
  LogOut,
  Mic,
  Moon,
  PencilLine,
  Plus,
  ScanText,
  Settings,
  ShieldCheck,
  Sun,
  Table,
  User,
} from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from './ui/command';
import { useUIStore } from '../lib/store/ui-store';
import { useTheme } from '../lib/theme-context';

const NAV_ITEMS = [
  { href: '/upload', label: 'Transkription', Icon: Mic, keywords: 'audio diktat record' },
  { href: '/tabellen', label: 'Tabellen', Icon: Table, keywords: 'tabelle excel csv' },
  { href: '/translate', label: 'Übersetzung', Icon: Languages, keywords: 'translate sprache' },
  { href: '/ocr', label: 'OCR', Icon: ScanText, keywords: 'bild scan dokument text' },
  { href: '/textoptimierung', label: 'Textoptimierung', Icon: PencilLine, keywords: 'text edit redaktion' },
  { href: '/transcriptions', label: 'Historie', Icon: History, keywords: 'archiv liste verlauf' },
];

export default function CommandPalette() {
  const router = useRouter();
  const { data: session } = useSession();
  const { commandPaletteOpen, closeCommandPalette, setCommandPaletteOpen } = useUIStore();
  const { resolvedTheme, toggleTheme } = useTheme();

  const run = (fn) => {
    closeCommandPalette();
    // Defer so close animation isn't aborted by the navigation.
    setTimeout(fn, 0);
  };

  return (
    <CommandDialog open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen}>
      <CommandInput placeholder="Befehl, Seite oder Aktion suchen…" />
      <CommandList>
        <CommandEmpty>Keine Treffer.</CommandEmpty>

        <CommandGroup heading="Navigation">
          {NAV_ITEMS.map(({ href, label, Icon, keywords }) => (
            <CommandItem
              key={href}
              value={`${label} ${keywords}`}
              onSelect={() => run(() => router.push(href))}
            >
              <Icon aria-hidden="true" />
              {label}
            </CommandItem>
          ))}
          <CommandItem
            value="Einstellungen settings konfiguration"
            onSelect={() => run(() => router.push('/settings'))}
          >
            <Settings aria-hidden="true" />
            Einstellungen
          </CommandItem>
          <CommandItem
            value="Profil account user"
            onSelect={() => run(() => router.push('/profile'))}
          >
            <User aria-hidden="true" />
            Profil
          </CommandItem>
          {session?.user?.role === 'admin' && (
            <CommandItem
              value="Admin Benutzerverwaltung"
              onSelect={() => run(() => router.push('/admin/users'))}
            >
              <ShieldCheck aria-hidden="true" />
              Admin
            </CommandItem>
          )}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Aktionen">
          <CommandItem
            value="neue transkription new upload"
            onSelect={() => run(() => router.push('/upload'))}
          >
            <Plus aria-hidden="true" />
            Neue Transkription
            <CommandShortcut>N</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="theme wechseln dunkel hell light dark mode"
            onSelect={() => run(() => toggleTheme())}
          >
            {resolvedTheme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
            {resolvedTheme === 'dark' ? 'Helles Design' : 'Dunkles Design'}
          </CommandItem>
          {session && (
            <CommandItem
              value="abmelden logout"
              onSelect={() => run(() => signOut({ callbackUrl: '/login' }))}
            >
              <LogOut aria-hidden="true" />
              Abmelden
            </CommandItem>
          )}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
