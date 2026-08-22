import Head from 'next/head';
import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { Plug } from 'lucide-react';
import LoadingSpinner from '../../../components/LoadingSpinner';
import OpenRouterIntegrationPanel from '../../../components/settings/OpenRouterIntegrationPanel';
import VexaIntegrationPanel from '../../../components/settings/VexaIntegrationPanel';
import { useCurrentOrg } from '../../../lib/use-current-org';
import { usePermission } from '../../../lib/use-permission';
import { useTranslations } from '../../../lib/i18n';

export default function WorkspaceIntegrationsPage() {
  const router = useRouter();
  const { status: authStatus } = useSession();
  const { org, isLoading: orgLoading } = useCurrentOrg();
  const canEditIntegrations = usePermission('meeting.admin');
  const t = useTranslations('organization.integrations');
  const tCommon = useTranslations('common');
  const tNav = useTranslations('nav');

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.replace('/login?next=/settings/organization/integrations');
    }
  }, [authStatus, router]);

  if (authStatus === 'loading' || orgLoading) return <LoadingSpinner />;
  if (!org) {
    return <main className="max-w-3xl mx-auto py-12 text-center text-secondary">{tCommon('noWorkspace')}</main>;
  }

  return (
    <>
      <Head>
        <title>{`${t('title')} – GhostTyper`}</title>
      </Head>
      <main className="max-w-5xl mx-auto pb-20 animate-fade-in space-y-10">
        <header className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-secondary">{org.name}</p>
            <h1 className="text-2xl font-bold text-primary mt-1 flex items-center gap-2">
              <Plug className="w-5 h-5" /> {t('title')}
            </h1>
            <p className="text-sm text-secondary mt-1 max-w-prose">{t('description')}</p>
          </div>
          <Link
            href="/settings/organization"
            className="text-xs text-secondary hover:text-primary transition-colors whitespace-nowrap"
          >
            ← {tNav('admin')}
          </Link>
        </header>

        <section className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-secondary uppercase tracking-widest">{t('aiProviders')}</h2>
            <p className="text-xs text-secondary mt-1 max-w-prose">{t('aiProvidersHint')}</p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <OpenRouterIntegrationPanel canEdit={canEditIntegrations} />
          </div>
        </section>

        <section className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-secondary uppercase tracking-widest">{t('meetingBots')}</h2>
            <p className="text-xs text-secondary mt-1 max-w-prose">{t('meetingBotsHint')}</p>
          </div>
          <VexaIntegrationPanel canEdit={canEditIntegrations} />
        </section>

      </main>
    </>
  );
}
