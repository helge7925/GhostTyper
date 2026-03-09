import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../auth/[...nextauth]';
import { enforceRateLimit, logApiError, serverError } from '../../../../../lib/api-utils';
import {
  addRealtimeMemberByEmail,
  getRealtimeSessionForUser,
  removeRealtimeMember,
} from '../../../../../lib/realtime-service';
import { logAuditEvent } from '../../../../../lib/audit-log';

function parseSessionId(rawId) {
  const parsed = Number.parseInt(rawId, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const sessionId = parseSessionId(req.query.id);
  if (!sessionId) {
    return res.status(400).json({ message: 'Ungültige Session-ID' });
  }

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'realtime-session-members',
    identifier: `user:${session.user.id}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!allowed) return;

  try {
    if (req.method === 'POST') {
      const { email, role } = req.body || {};
      const added = await addRealtimeMemberByEmail({
        sessionId,
        actorUserId: session.user.id,
        email,
        role,
      });
      await logAuditEvent({
        userId: session.user.id,
        action: 'realtime.member_added',
        targetType: 'realtime_session',
        targetId: String(sessionId),
        metadata: {
          email: String(email || '').toLowerCase(),
          role: role || 'viewer',
        },
      });
      return res.status(201).json(added);
    }

    if (req.method === 'DELETE') {
      const removed = await removeRealtimeMember({
        sessionId,
        actorUserId: session.user.id,
        memberUserId: req.body?.userId,
      });
      if (!removed) {
        return res.status(404).json({ message: 'Mitglied nicht gefunden' });
      }

      const updatedSession = await getRealtimeSessionForUser(sessionId, session.user.id);
      await logAuditEvent({
        userId: session.user.id,
        action: 'realtime.member_removed',
        targetType: 'realtime_session',
        targetId: String(sessionId),
        metadata: {
          removedUserId: Number.parseInt(req.body?.userId, 10) || null,
        },
      });
      return res.status(200).json(updatedSession?.members || []);
    }

    return res.status(405).json({ message: 'Method not allowed' });
  } catch (error) {
    if (error?.message === 'INVALID_EMAIL') {
      return res.status(400).json({ message: 'E-Mail ist erforderlich' });
    }
    if (error?.message === 'USER_NOT_FOUND') {
      return res.status(404).json({ message: 'Benutzer mit dieser E-Mail wurde nicht gefunden' });
    }
    if (error?.message === 'FORBIDDEN') {
      return res.status(403).json({ message: 'Nur Owner dürfen Mitglieder verwalten' });
    }
    if (error?.message === 'INVALID_MEMBER_ID') {
      return res.status(400).json({ message: 'Ungültige Benutzer-ID' });
    }
    if (error?.message === 'CANNOT_REMOVE_OWNER') {
      return res.status(400).json({ message: 'Owner kann nicht entfernt werden' });
    }
    logApiError('Realtime session members API error', error);
    return serverError(res, 'Mitglieder konnten nicht aktualisiert werden');
  }
}
