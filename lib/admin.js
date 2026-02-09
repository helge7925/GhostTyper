import { getServerSession } from 'next-auth/next';
import { authOptions } from '../pages/api/auth/[...nextauth]';

/**
 * Middleware: checks that the request comes from an authenticated admin user.
 * Returns the session on success, or sends 401/403 and returns null.
 */
export async function requireAdmin(req, res) {
  const session = await getServerSession(req, res, authOptions);

  if (!session) {
    res.status(401).json({ message: 'Nicht authentifiziert' });
    return null;
  }

  if (session.user.role !== 'admin') {
    res.status(403).json({ message: 'Keine Administratorrechte' });
    return null;
  }

  return session;
}
