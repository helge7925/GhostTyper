import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';
import { enforceRateLimit, logApiError } from '../../lib/api-utils';
import { listAuditEventsForUser } from '../../lib/audit-log';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'audit-log',
    identifier: `user:${session.user.id}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!allowed) return;

  try {
    const limit = Number.parseInt(req.query.limit, 10) || 80;
    const events = await listAuditEventsForUser(session.user.id, limit);
    return res.status(200).json({ events });
  } catch (error) {
    if (error?.code === '42P01' || error?.code === '42703') {
      return res.status(200).json({ events: [] });
    }
    logApiError('Audit log API error', error);
    return res.status(500).json({ message: 'Audit-Log konnte nicht geladen werden' });
  }
}
