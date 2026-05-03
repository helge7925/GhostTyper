import { useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';

/**
 * React hook that surfaces the active organisation, the user's role within
 * it, and a `switchOrg` action that re-issues the JWT with a new active org.
 *
 * The session shape is populated by NextAuth callbacks in
 * pages/api/auth/[...nextauth].js:
 *   session.user.currentOrganizationId
 *   session.user.organizations: [{ id, name, slug, role, isPersonal }]
 *
 * Returns a stable shape; consumers can destructure safely even before the
 * session has finished loading.
 */
export function useCurrentOrg() {
  const { data: session, status, update } = useSession();
  const router = useRouter();

  const organizations = useMemo(
    () => Array.isArray(session?.user?.organizations) ? session.user.organizations : [],
    [session?.user?.organizations],
  );

  const currentOrgId = session?.user?.currentOrganizationId ?? null;

  const org = useMemo(() => {
    if (!currentOrgId) return null;
    return organizations.find((o) => String(o.id) === String(currentOrgId)) ?? null;
  }, [organizations, currentOrgId]);

  const switchOrg = useCallback(
    async (organizationId) => {
      if (!organizationId) return false;
      const response = await fetch('/api/auth/switch-org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      });
      if (!response.ok) return false;
      // Tell NextAuth to re-run the jwt callback with the new desired org.
      if (typeof update === 'function') {
        await update({ currentOrganizationId: organizationId });
      }
      // Re-execute the current page's getServerSideProps / data fetches with
      // the new org scope. Without this, lists like /transcriptions still
      // show the previous workspace's data until the user navigates manually.
      try {
        await router.replace(router.asPath, undefined, { scroll: false });
      } catch {
        // ignore: best-effort reload
      }
      return true;
    },
    [update, router],
  );

  return {
    organizations,
    org,
    role: org?.role ?? null,
    currentOrgId,
    isLoading: status === 'loading',
    switchOrg,
  };
}
