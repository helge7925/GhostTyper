import { useRouter } from 'next/router';
import { useSession, signOut } from 'next-auth/react';
import {
  Building2,
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
import { usePermission } from '../lib/use-permission';
import { useTranslations } from '../lib/i18n';

// Routes + locale-independent search keywords (so users can type `audio` or
// `tabelle` regardless of UI locale).
const NAV_ITEMS = [
  { href: '/upload', labelKey: 'transcription', Icon: Mic, keywords: 'audio diktat record record audio dictation' },
  { href: '/tabellen', labelKey: 'tables', Icon: Table, keywords: 'tabelle table excel csv spreadsheet' },
  { href: '/translate', labelKey: 'translation', Icon: Languages, keywords: 'translate sprache language uebersetzen' },
  { href: '/ocr', labelKey: 'ocr', Icon: ScanText, keywords: 'bild scan dokument text image scanner' },
  { href: '/textoptimierung', labelKey: 'textOptimization', Icon: PencilLine, keywords: 'text edit redaktion refine optimize' },
  { href: '/transcriptions', labelKey: 'history', Icon: History, keywords: 'archiv liste verlauf history archive list' },
];

export default function CommandPalette() {
  const router = useRouter();
  const { data: session } = useSession();
  const { commandPaletteOpen, closeCommandPalette, setCommandPaletteOpen } = useUIStore();
  const { resolvedTheme, toggleTheme } = useTheme();
  const canReadAudit = usePermission('audit.read');
  const t = useTranslations('command');
  const tNav = useTranslations('nav');
  const tTheme = useTranslations('theme');

  const run = (fn) => {
    closeCommandPalette();
    // Defer so close animation isn't aborted by the navigation.
    setTimeout(fn, 0);
  };

  return (
    <CommandDialog open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen}>
      <CommandInput placeholder={t('placeholder')} />
      <CommandList>
        <CommandEmpty>{t('noResults')}</CommandEmpty>

        <CommandGroup heading={t('groups.navigation')}>
          {NAV_ITEMS.map(({ href, labelKey, Icon, keywords }) => (
            <CommandItem
              key={href}
              value={`${tNav(labelKey)} ${keywords}`}
              onSelect={() => run(() => router.push(href))}
            >
              <Icon aria-hidden="true" />
              {tNav(labelKey)}
            </CommandItem>
          ))}
          <CommandItem
            value={`${tNav('settings')} settings konfiguration configuration`}
            onSelect={() => run(() => router.push('/settings'))}
          >
            <Settings aria-hidden="true" />
            {tNav('settings')}
          </CommandItem>
          <CommandItem
            value={`${tNav('profile')} profil account user`}
            onSelect={() => run(() => router.push('/profile'))}
          >
            <User aria-hidden="true" />
            {tNav('profile')}
          </CommandItem>
          {session && (
            <CommandItem
              value="workspace organisation organization team"
              onSelect={() => run(() => router.push('/settings/organization'))}
            >
              <Building2 aria-hidden="true" />
              {t('items.manageWorkspace')}
            </CommandItem>
          )}
          {canReadAudit && (
            <CommandItem
              value="audit log sicherheit aktivität security activity"
              onSelect={() => run(() => router.push('/audit'))}
            >
              <ShieldCheck aria-hidden="true" />
              {t('items.auditLog')}
            </CommandItem>
          )}
          {session?.user?.role === 'admin' && (
            <CommandItem
              value={`${tNav('admin')} benutzerverwaltung user management`}
              onSelect={() => run(() => router.push('/admin/users'))}
            >
              <ShieldCheck aria-hidden="true" />
              {tNav('admin')}
            </CommandItem>
          )}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading={t('groups.actions')}>
          <CommandItem
            value="neue transkription new transcription upload"
            onSelect={() => run(() => router.push('/upload'))}
          >
            <Plus aria-hidden="true" />
            {t('items.newTranscription')}
            <CommandShortcut>N</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="theme wechseln dunkel hell light dark mode"
            onSelect={() => run(() => toggleTheme())}
          >
            {resolvedTheme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
            {resolvedTheme === 'dark' ? tTheme('lightLabel') : tTheme('darkLabel')}
          </CommandItem>
          {session && (
            <CommandItem
              value="abmelden logout sign out"
              onSelect={() => run(() => signOut({ callbackUrl: '/login' }))}
            >
              <LogOut aria-hidden="true" />
              {tNav('logout')}
            </CommandItem>
          )}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
