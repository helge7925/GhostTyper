import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../pages/api/auth/[...nextauth]';
import { query } from '../db';
import { hasPermission } from '../permissions';

/**
 * Server-side equivalent of `useCurrentOrg`. Returns the active org + the
 * caller's role, or `null` if the session has no usable org context.
 *
 * Used by `withOrgScope` below; can also be called directly inside an API
 * handler when fine-grained branching is needed.
 */
export async function getOrgContext(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) return null;

  const userId = session.user.id;
  const requestedOrgId = session.user.currentOrganizationId ?? null;

  // Fetch org membership; pick the requested one (if the user is still a
  // member), otherwise fall back to the personal org, otherwise the most
  // recently joined.
  const result = await query(
    `SELECT o.id, o.name, o.slug, o.plan, o.is_personal, m.role
       FROM organization_members m
       JOIN organizations o ON o.id = m.organization_id
      WHERE m.user_id = $1
      ORDER BY o.is_personal DESC, m.joined_at ASC`,
    [userId],
  );
  const memberships = result.rows;
  if (memberships.length === 0) return null;

  const active =
    memberships.find((m) => String(m.id) === String(requestedOrgId)) ||
    memberships.find((m) => m.is_personal) ||
    memberships[0];

  return {
    user: { id: userId, email: session.user.email, role: session.user.role },
    org: {
      id: active.id,
      name: active.name,
      slug: active.slug,
      plan: active.plan,
      isPersonal: !!active.is_personal,
    },
    role: active.role,
    memberships: memberships.map((m) => ({
      id: m.id,
      name: m.name,
      slug: m.slug,
      plan: m.plan,
      isPersonal: !!m.is_personal,
      role: m.role,
    })),
  };
}

/**
 * Higher-order wrapper for API handlers. Resolves the active organisation,
 * optionally enforces a permission, then invokes the handler with `req.org`,
 * `req.role`, `req.userId` populated.
 *
 *   export default withOrgScope({ permission: 'transcription.write' }, async (req, res) => {
 *     // req.org.id is guaranteed; SQL queries should filter by it.
 *   });
 *
 * Errors are surfaced as JSON with stable codes:
 *   401 UNAUTHENTICATED
 *   403 NO_ORG_MEMBERSHIP
 *   403 FORBIDDEN
 */
export function withOrgScope(options, handler) {
  // Allow `withOrgScope(handler)` with default options.
  if (typeof options === 'function') {
    handler = options;
    options = {};
  }
  const { permission = null } = options || {};

  return async (req, res) => {
    let ctx;
    try {
      ctx = await getOrgContext(req, res);
    } catch (error) {
      res.status(500).json({ code: 'ORG_CONTEXT_FAILED', message: 'Org-Kontext konnte nicht aufgelöst werden.' });
      return;
    }

    if (!ctx) {
      res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Bitte anmelden.' });
      return;
    }
    if (!ctx.org) {
      res.status(403).json({ code: 'NO_ORG_MEMBERSHIP', message: 'Keine Workspace-Mitgliedschaft.' });
      return;
    }
    if (permission && !hasPermission(ctx.role, permission)) {
      res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Diese Aktion ist mit Ihrer Rolle nicht erlaubt.',
        permission,
      });
      return;
    }

    req.userId = ctx.user.id;
    req.org = ctx.org;
    req.role = ctx.role;
    req.memberships = ctx.memberships;
    return handler(req, res);
  };
}
