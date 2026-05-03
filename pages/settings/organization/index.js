import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { Building2, ChevronRight, BarChart3, Plug, Settings as SettingsIcon, ShieldCheck, Users } from 'lucide-react';
import LoadingSpinner from '../../../components/LoadingSpinner';
import { useCurrentOrg } from '../../../lib/use-current-org';
import { usePermission } from '../../../lib/use-permission';
import { useTranslations } from '../../../lib/i18n';

function StatTile({ Icon, label, value, hint }) {
  return (
    <div className="bg-surface border border-subtle rounded-2xl p-5 shadow-xl">
      <div className="flex items-center gap-2 text-secondary text-[10px] font-bold uppercase tracking-widest">
        <Icon className="w-3.5 h-3.5" aria-hidden="true" />
        {label}
      </div>
      <p className="mt-2 text-xl font-semibold text-primary truncate">{value}</p>
      {hint && <p className="mt-1 text-xs text-secondary">{hint}</p>}
    </div>
  );
}

export default function OrgSettingsPage() {
  const router = useRouter();
  const { status: authStatus } = useSession();
  const { org, role, isLoading: orgLoading } = useCurrentOrg();
  const canManageMembers = usePermission('org.members.read');
  const canManageSettings = usePermission('org.settings');
  const t = useTranslations('organization');
  const tNav = useTranslations('nav');
  const tCommon = useTranslations('common');

  const [memberCount, setMemberCount] = useState(null);

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.replace('/login?next=/settings/organization');
    }
  }, [authStatus, router]);

  useEffect(() => {
    if (!org || !canManageMembers) return;
    let cancelled = false;
    fetch('/api/organizations/members')
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (cancelled) return;
        setMemberCount(Array.isArray(payload?.members) ? payload.members.length : null);
      })
      .catch(() => setMemberCount(null));
    return () => {
      cancelled = true;
    };
  }, [org, canManageMembers]);

  if (authStatus === 'loading' || orgLoading) {
    return <LoadingSpinner />;
  }
  if (!org) {
    return (
      <main className="max-w-3xl mx-auto py-12 text-center text-secondary">
        {tCommon('noWorkspace')}
      </main>
    );
  }

  return (
    <>
      <Head>
        <title>{`${t('label')} – GhostTyper`}</title>
      </Head>
      <main className="max-w-5xl mx-auto pb-20 animate-fade-in space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-secondary">{t('label')}</p>
            <h1 className="text-2xl font-bold text-primary mt-1">{org.name}</h1>
            <p className="text-sm text-secondary mt-1">
              {org.isPersonal ? t('personalLong') : t('teamLong')} · {t('yourRole')}: {role}
            </p>
          </div>
          <Link
            href="/settings"
            className="text-xs text-secondary hover:text-primary transition-colors"
          >
            ← {tNav('settings')}
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <StatTile Icon={Building2} label={t('type')} value={org.isPersonal ? t('personal') : t('team')} hint={org.slug} />
          <StatTile
            Icon={Users}
            label={t('memberCount')}
            value={memberCount ?? '—'}
            hint={canManageMembers ? t('tiles.membersHintIncluded') : t('tiles.membersHintLimited')}
          />
        </div>

        <nav className="bg-surface border border-subtle rounded-2xl divide-y divide-subtle overflow-hidden">
          {canManageMembers && (
            <Link
              href="/settings/organization/members"
              className="flex items-center justify-between px-5 py-4 hover:bg-hover-subtle transition-colors"
            >
              <div className="flex items-center gap-3">
                <Users className="w-5 h-5 text-secondary" aria-hidden="true" />
                <div>
                  <p className="text-sm font-medium text-primary">{t('links.members')}</p>
                  <p className="text-xs text-secondary">{t('links.membersDesc')}</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-secondary" aria-hidden="true" />
            </Link>
          )}
          {canManageSettings && (
            <Link
              href="/settings/organization/integrations"
              className="flex items-center justify-between px-5 py-4 hover:bg-hover-subtle transition-colors"
            >
              <div className="flex items-center gap-3">
                <Plug className="w-5 h-5 text-secondary" aria-hidden="true" />
                <div>
                  <p className="text-sm font-medium text-primary">{t('links.integrations')}</p>
                  <p className="text-xs text-secondary">{t('links.integrationsDesc')}</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-secondary" aria-hidden="true" />
            </Link>
          )}
          <Link
            href="/settings/organization/preferences"
            className="flex items-center justify-between px-5 py-4 hover:bg-hover-subtle transition-colors"
          >
            <div className="flex items-center gap-3">
              <SettingsIcon className="w-5 h-5 text-secondary" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium text-primary">{t('links.preferences')}</p>
                <p className="text-xs text-secondary">{t('links.preferencesDesc')}</p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-secondary" aria-hidden="true" />
          </Link>
          <Link
            href="/settings/organization/usage"
            className="flex items-center justify-between px-5 py-4 hover:bg-hover-subtle transition-colors"
          >
            <div className="flex items-center gap-3">
              <BarChart3 className="w-5 h-5 text-secondary" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium text-primary">{t('links.usage')}</p>
                <p className="text-xs text-secondary">{t('links.usageDesc')}</p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-secondary" aria-hidden="true" />
          </Link>
          <Link
            href="/audit"
            className="flex items-center justify-between px-5 py-4 hover:bg-hover-subtle transition-colors"
          >
            <div className="flex items-center gap-3">
              <ShieldCheck className="w-5 h-5 text-secondary" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium text-primary">{t('links.audit')}</p>
                <p className="text-xs text-secondary">{t('links.auditDesc')}</p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-secondary" aria-hidden="true" />
          </Link>
        </nav>

        {!canManageSettings && (
          <p className="text-xs text-secondary">{t('settingsRestricted')}</p>
        )}
      </main>
    </>
  );
}
