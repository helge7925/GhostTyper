import { getServerSession } from 'next-auth/next';
import { authOptions } from '../pages/api/auth/[...nextauth]';
import { query } from './db';

// Resolves the authoritative platform role from the database for the given
// user id. JWT-cached roles in NextAuth sessions persist until next refresh,
// so a demoted admin would otherwise keep elevated rights for the lifetime of
// their token. M2 (cybersecurity-audit-2026-05-09): always re-verify against
// users.role for privileged routes, and treat any DB lookup miss as denied.
async function resolveCurrentRole(userId) {
  if (!userId) return null;
  try {
    const result = await query('SELECT role FROM users WHERE id = $1', [userId]);
    return result.rows[0]?.role || null;
  } catch {
    return null;
  }
}

export async function requireAdmin(req, res) {
  const session = await getServerSession(req, res, authOptions);

  if (!session) {
    res.status(401).json({ message: 'Nicht authentifiziert' });
    return null;
  }

  const currentRole = await resolveCurrentRole(session.user?.id);
  if (currentRole !== 'admin') {
    res.status(403).json({ message: 'Keine Administratorrechte' });
    return null;
  }
  session.user.role = currentRole;

  return session;
}

export async function requireAuditReader(req, res) {
  const session = await getServerSession(req, res, authOptions);

  if (!session) {
    res.status(401).json({ message: 'Nicht authentifiziert' });
    return null;
  }

  const currentRole = await resolveCurrentRole(session.user?.id);
  if (!['admin', 'auditor'].includes(currentRole)) {
    res.status(403).json({ message: 'Keine Audit-Berechtigung' });
    return null;
  }
  session.user.role = currentRole;

  return session;
}
