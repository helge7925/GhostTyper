import Link from 'next/link';
import { useRouter } from 'next/router';
import { useSession, signOut } from 'next-auth/react';
import {
  Building2,
  CheckSquare,
  Files,
  Languages,
  Library,
  LogOut,
  MessageSquare,
  Mic,
  PencilLine,
  ScanText,
  Settings as SettingsIcon,
  Table as TableIcon,
  Video,
} from 'lucide-react';
import { Sheet, SheetContent, SheetTitle } from './ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { cn } from '../lib/utils';
import { useUIStore } from '../lib/store/ui-store';
import { useTranslations } from '../lib/i18n';
import { useVexaIntegrationEnabled } from '../lib/use-vexa-integration';
import { usePermission } from '../lib/use-permission';

// Primary tool order, top → bottom:
//   Remote Meeting (when permitted + workspace has Vexa enabled — see
//   `showRemoteMeeting` below) is rendered as the first nav row.
//   The other tools follow in the order Transcription → Translation
//   → OCR → Tables → Text Refinement → Chat, and the document archive
//   ("Dateien" / "Files", was "Historie" / "History") is always last.
const PRIMARY_NAV_LINKS = [
  { href: '/upload', labelKey: 'transcription', Icon: Mic },
  { href: '/translate', labelKey: 'translation', Icon: Languages },
  { href: '/ocr', labelKey: 'ocr', Icon: ScanText },
  { href: '/tabellen', labelKey: 'tables', Icon: TableIcon },
  { href: '/textoptimierung', labelKey: 'textOptimization', Icon: PencilLine },
  { href: '/chat', labelKey: 'chat', Icon: MessageSquare },
];

const TASKS_NAV_LINK = {
  href: '/tasks',
  labelKey: 'tasks',
  Icon: CheckSquare,
};

const FILES_NAV_LINK = {
  href: '/transcriptions',
  labelKey: 'files',
  Icon: Files,
};

const REMOTE_MEETING_LINK = {
  href: '/transcriptions?meeting=1',
  labelKey: 'remoteMeeting',
  Icon: Video,
};

const KNOWLEDGE_NAV_LINK = {
  href: '/knowledge',
  labelKey: 'knowledge',
  Icon: Library,
};

/**
 * Single nav row, optionally tooltip-wrapped when the sidebar is collapsed.
 */
function NavRow({ href, label, Icon, isActive, collapsed, onNavigate }) {
  const link = (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'flex items-center gap-3 rounded-xl text-sm font-medium transition-colors',
        collapsed ? 'h-11 w-11 justify-center mx-auto' : 'px-4 py-3',
        isActive
          ? 'bg-accent/10 text-accent'
          : 'text-secondary hover:text-primary hover:bg-hover-subtle',
      )}
    >
      <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );

  if (!collapsed) return link;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Footer button (Logout, Theme), optionally tooltip-wrapped.
 */
function FooterButton({ label, Icon, onClick, danger = false, collapsed }) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 rounded-xl text-sm font-medium transition-colors',
        collapsed ? 'h-11 w-11 justify-center mx-auto' : 'w-full px-4 py-3',
        danger
          ? 'text-secondary hover:text-danger hover:bg-danger/10'
          : 'text-secondary hover:text-primary hover:bg-hover-subtle',
      )}
      aria-label={label}
    >
      <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
      {!collapsed && <span>{label}</span>}
    </button>
  );

  if (!collapsed) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Inner content used by both the persistent desktop sidebar and the
 * mobile/tablet sheet drawer.
 */
function SidebarBody({ collapsed = false, onNavigate }) {
  const router = useRouter();
  const { data: session } = useSession();
  const tNav = useTranslations('nav');
  const canStartMeeting = usePermission('meeting.start');
  const canManageWorkspace = usePermission('org.settings');
  const canReadKnowledge = usePermission('knowledge.read');
  const canReadTasks = usePermission('task.read');
  const { enabled: vexaEnabled } = useVexaIntegrationEnabled();
  const showRemoteMeeting = canStartMeeting && vexaEnabled;
  if (!session) return null;

  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className={cn('p-4', collapsed && 'p-3')}>
        <Link
          href="/"
          onClick={onNavigate}
          className={cn(
            'flex items-center gap-3 rounded-lg p-2 hover:bg-hover-subtle transition-colors',
            collapsed && 'justify-center',
          )}
          aria-label="GhostTyper"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" width={28} height={28} className="w-7 h-7 shrink-0" />
          {!collapsed && (
            <span className="text-base font-bold tracking-tight text-primary truncate">GhostTyper</span>
          )}
        </Link>
      </div>

      {/* Navigation */}
      <nav
        className={cn('flex-1 space-y-1 overflow-y-auto scrollbar-hide', collapsed ? 'px-2 py-2' : 'px-3 py-2')}
        aria-label={tNav('ariaCurrent')}
      >
        {/* Remote Meeting — always first when available */}
        {showRemoteMeeting && (
          <NavRow
            href={REMOTE_MEETING_LINK.href}
            label={tNav(REMOTE_MEETING_LINK.labelKey)}
            Icon={REMOTE_MEETING_LINK.Icon}
            isActive={router.asPath === REMOTE_MEETING_LINK.href}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        )}

        {/* Active-tool entries */}
        {PRIMARY_NAV_LINKS.map((link) => (
          <NavRow
            key={link.href}
            href={link.href}
            label={tNav(link.labelKey)}
            Icon={link.Icon}
            isActive={router.pathname === link.href || router.pathname.startsWith(link.href + '/')}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        ))}

        {/* Workspace knowledge hub */}
        {canReadKnowledge && (
          <NavRow
            href={KNOWLEDGE_NAV_LINK.href}
            label={tNav(KNOWLEDGE_NAV_LINK.labelKey)}
            Icon={KNOWLEDGE_NAV_LINK.Icon}
            isActive={router.pathname === KNOWLEDGE_NAV_LINK.href || router.pathname.startsWith(KNOWLEDGE_NAV_LINK.href + '/')}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        )}

        {canReadTasks && (
          <NavRow
            href={TASKS_NAV_LINK.href}
            label={tNav(TASKS_NAV_LINK.labelKey)}
            Icon={TASKS_NAV_LINK.Icon}
            isActive={router.pathname === TASKS_NAV_LINK.href || router.pathname.startsWith(TASKS_NAV_LINK.href + '/')}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        )}

        {/* Document archive — always last */}
        <NavRow
          href={FILES_NAV_LINK.href}
          label={tNav(FILES_NAV_LINK.labelKey)}
          Icon={FILES_NAV_LINK.Icon}
          // `/transcriptions` (no query) is the archive view; the
          // `?meeting=1` deep-link is handled by the Remote-Meeting row
          // above. Match only the bare path so the two don't both
          // highlight when a user has the meeting drawer open.
          isActive={
            router.pathname === FILES_NAV_LINK.href
            && router.asPath.split('?')[0] === FILES_NAV_LINK.href
          }
          collapsed={collapsed}
          onNavigate={onNavigate}
        />
      </nav>

      {/* Footer: settings, admin, profile, logout */}
      <div
        className={cn(
          'mt-auto border-t border-subtle space-y-1',
          collapsed ? 'px-2 py-2' : 'p-3',
        )}
      >
        <NavRow
          href="/settings"
          label={tNav('settings')}
          Icon={SettingsIcon}
          isActive={router.pathname === '/settings'}
          collapsed={collapsed}
          onNavigate={onNavigate}
        />

        {canManageWorkspace && (
          <NavRow
            href="/settings/organization"
            label={tNav('workspaceAdmin')}
            Icon={Building2}
            isActive={router.pathname.startsWith('/settings/organization')}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        )}

        {/* Global system admin is now reachable from the workspace switcher
            (workspace creation) and via the Workspace-Admin pages — no need
            for a dedicated sidebar slot anymore. */}

        {/* Profile compact card (only when expanded) */}
        {!collapsed && (
          <Link
            href="/profile"
            onClick={onNavigate}
            className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-hover-subtle transition-colors group"
          >
            {session.user.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={session.user.avatar_url}
                alt=""
                className="w-8 h-8 rounded-full object-cover border border-subtle shrink-0"
              />
            ) : (
              <span className="w-8 h-8 rounded-full gradient-accent flex items-center justify-center text-xs font-bold text-white shrink-0">
                {session.user.email?.substring(0, 2)?.toUpperCase()}
              </span>
            )}
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-medium text-primary truncate group-hover:text-accent transition-colors">
                {session.user.name || tNav('profile')}
              </span>
              <span className="text-[10px] text-secondary truncate">{session.user.email}</span>
            </div>
          </Link>
        )}

        <FooterButton
          label={tNav('logout')}
          Icon={LogOut}
          onClick={() => signOut({ callbackUrl: '/login' })}
          danger
          collapsed={collapsed}
        />
      </div>
    </div>
  );
}

/**
 * Adaptive Sidebar.
 *
 *  ≥ xl (≥1280px): persistent left rail, collapsible (256px ↔ 64px).
 *  < xl:           overlay sheet drawer (mobile + tablet), opens via TopBar hamburger.
 */
export default function Sidebar() {
  const { data: session } = useSession();
  const { sidebarOpen, setSidebarOpen, sidebarCollapsed, closeSidebar } = useUIStore();
  const tNav = useTranslations('nav');

  if (!session) return null;

  return (
    <>
      {/* Persistent (xl+) */}
      <aside
        className={cn(
          'hidden xl:flex fixed inset-y-0 left-0 z-40 flex-col bg-canvas border-r border-subtle transition-[width] duration-200',
          sidebarCollapsed ? 'w-16' : 'w-64',
        )}
      >
        <SidebarBody collapsed={sidebarCollapsed} />
      </aside>

      {/* Sheet drawer (< xl) */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-72 p-0 xl:hidden">
          <SheetTitle className="sr-only">{tNav('ariaCurrent')}</SheetTitle>
          <SidebarBody collapsed={false} onNavigate={closeSidebar} />
        </SheetContent>
      </Sheet>
    </>
  );
}
