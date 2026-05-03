import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { Building2, Check, ChevronsUpDown, Loader2, Plus, User as UserIcon } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { useCurrentOrg } from '../lib/use-current-org';
import { useUiFeedback } from '../lib/use-ui-feedback';
import { cn } from '../lib/utils';

/**
 * Compact org-picker for the TopBar. Lives in the centre slot; collapses to
 * an icon-only trigger on small screens. Global admins also see a
 * "+ Neuer Workspace" item that opens a modal.
 */
export default function WorkspaceSwitcher({ className = '' }) {
  const { organizations, org, switchOrg, isLoading } = useCurrentOrg();
  const { data: session } = useSession();
  const { showToast } = useUiFeedback();
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createOwnerEmail, setCreateOwnerEmail] = useState('');
  const [creating, setCreating] = useState(false);

  const isSystemAdmin = session?.user?.role === 'admin';

  if (isLoading || organizations.length === 0) return null;

  const handleSelect = async (id) => {
    if (!id || String(id) === String(org?.id) || busy) return;
    setBusy(true);
    try {
      await switchOrg(id);
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async (event) => {
    event.preventDefault();
    if (!createName.trim() || creating) return;
    setCreating(true);
    try {
      const res = await fetch('/api/admin/organizations', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createName.trim(),
          ownerEmail: createOwnerEmail.trim() || undefined,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.message || 'Workspace konnte nicht angelegt werden.');
      showToast('Workspace angelegt.', 'success');
      setCreateOpen(false);
      setCreateName('');
      setCreateOwnerEmail('');
      // Switch to the newly created workspace if the admin owns it.
      if (payload.id) {
        try {
          await switchOrg(payload.id);
        } catch {
          /* the user may not be a member if they assigned ownership to someone else */
        }
      }
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setCreating(false);
    }
  };

  const triggerLabel = org?.name || 'Workspace wählen';

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={busy}
            className={cn(
              'inline-flex items-center gap-2 h-9 max-w-[220px] rounded-xl border border-subtle bg-surface px-3 text-sm text-primary hover:bg-hover-subtle transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60',
              className,
            )}
            aria-label={`Aktiver Workspace: ${triggerLabel}`}
          >
            {org?.isPersonal ? (
              <UserIcon className="w-4 h-4 shrink-0 text-secondary" aria-hidden="true" />
            ) : (
              <Building2 className="w-4 h-4 shrink-0 text-secondary" aria-hidden="true" />
            )}
            <span className="truncate">{triggerLabel}</span>
            <ChevronsUpDown className="w-3.5 h-3.5 shrink-0 text-secondary ml-auto" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Workspace wechseln</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {organizations.map((item) => {
            const isActive = String(item.id) === String(org?.id);
            const Icon = item.isPersonal ? UserIcon : Building2;
            return (
              <DropdownMenuItem
                key={item.id}
                onSelect={(event) => {
                  event.preventDefault();
                  handleSelect(item.id);
                }}
                className={cn('flex items-center gap-2', isActive && 'text-accent')}
              >
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                <div className="flex flex-col flex-1 min-w-0">
                  <span className="truncate text-sm">{item.name}</span>
                  <span className="text-[10px] uppercase tracking-wider text-secondary">
                    {item.role}
                  </span>
                </div>
                {isActive && <Check className="w-4 h-4 text-accent" aria-hidden="true" />}
              </DropdownMenuItem>
            );
          })}
          {isSystemAdmin && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  setCreateOpen(true);
                }}
                className="flex items-center gap-2 text-accent"
              >
                <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span className="text-sm">Neuer Workspace</span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Neuer Workspace</DialogTitle>
            <DialogDescription>
              Legt einen Team-Workspace an. Du wirst Owner — oder benenne einen anderen Nutzer per E-Mail.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-secondary mb-1.5">Workspace-Name</label>
              <input
                type="text"
                required
                autoFocus
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="Acme GmbH"
                className="w-full bg-surface-elevated border border-subtle rounded-xl px-4 py-2.5 text-sm text-primary outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary mb-1.5">
                Owner (optional, E-Mail eines bestehenden Nutzers)
              </label>
              <input
                type="email"
                value={createOwnerEmail}
                onChange={(e) => setCreateOwnerEmail(e.target.value)}
                placeholder="leer lassen, um selbst Owner zu werden"
                className="w-full bg-surface-elevated border border-subtle rounded-xl px-4 py-2.5 text-sm text-primary outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <DialogFooter>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                disabled={creating}
                className="px-4 py-2 rounded-xl text-sm border border-subtle text-primary hover:bg-hover-subtle"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                disabled={creating || !createName.trim()}
                className="px-4 py-2 rounded-xl text-sm bg-accent text-white hover:bg-accent/90 disabled:opacity-50 inline-flex items-center gap-2"
              >
                {creating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Anlegen
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
