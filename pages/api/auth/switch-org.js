import { getServerSession } from 'next-auth/next';
import { authOptions } from './[...nextauth]';
import { query } from '../../../lib/db';

/**
 * Accept a workspace switch and let NextAuth re-issue the JWT. The actual
 * `currentOrganizationId` write happens inside the jwt callback on the next
 * `update()`/refresh — here we only verify the user is still a member.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
    return;
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) {
    res.status(401).json({ code: 'UNAUTHENTICATED' });
    return;
  }

  const { organizationId } = req.body || {};
  const orgId = Number(organizationId);
  if (!Number.isFinite(orgId) || orgId <= 0) {
    res.status(400).json({ code: 'INVALID_INPUT', message: 'organizationId fehlt oder ungültig.' });
    return;
  }

  // Confirm membership server-side before granting the switch.
  const result = await query(
    `SELECT 1 FROM organization_members WHERE organization_id = $1 AND user_id = $2`,
    [orgId, session.user.id],
  );
  if (result.rows.length === 0) {
    res.status(403).json({ code: 'NOT_A_MEMBER', message: 'Sie sind kein Mitglied dieses Workspace.' });
    return;
  }

  // Server side is happy. The client now calls `update()` from useSession()
  // with `{ currentOrganizationId: orgId }` to persist the switch into the JWT.
  res.status(200).json({ ok: true, organizationId: orgId });
}
