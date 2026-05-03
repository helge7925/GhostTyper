import { useMemo } from 'react';
import { hasPermission } from './permissions';
import { useCurrentOrg } from './use-current-org';

/**
 * React hook for permission checks in the UI. Wrap any disable-or-hide
 * decision so it stays consistent with the API-side `assertPermission`.
 *
 *   const canDelete = usePermission('transcription.delete');
 *   <Button disabled={!canDelete}>Löschen</Button>
 */
export function usePermission(permission) {
  const { role } = useCurrentOrg();
  return useMemo(() => hasPermission(role, permission), [role, permission]);
}
