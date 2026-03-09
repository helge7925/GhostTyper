import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../auth/[...nextauth]';
import { enforceRateLimit, logApiError, serverError } from '../../../../lib/api-utils';
import {
  createRealtimeSession,
  listRealtimeSessionsForUser,
} from '../../../../lib/realtime-service';

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'realtime-sessions',
    identifier: `user:${session.user.id}`,
    limit: 180,
    windowMs: 60_000,
  });
  if (!allowed) return;

  try {
    if (req.method === 'GET') {
      const rows = await listRealtimeSessionsForUser(session.user.id);
      return res.status(200).json(rows);
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const created = await createRealtimeSession({
        ownerUserId: session.user.id,
        title: body.title,
        language: body.language,
        model: body.model,
        documentTemplate: body.documentTemplate,
      });
      return res.status(201).json(created);
    }

    return res.status(405).json({ message: 'Method not allowed' });
  } catch (error) {
    logApiError('Realtime sessions API error', error);
    return serverError(res, 'Realtime-Session konnte nicht verarbeitet werden');
  }
}
