import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../auth/[...nextauth]';
import { enforceRateLimit, logApiError, serverError } from '../../../../lib/api-utils';
import {
  getRealtimeSessionForUser,
  updateRealtimeSessionMeta,
} from '../../../../lib/realtime-service';
import { runRealtimeFinalization } from '../../../../lib/realtime-finalizer';
import { logAuditEvent } from '../../../../lib/audit-log';

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
    keyPrefix: 'realtime-session-item',
    identifier: `user:${session.user.id}`,
    limit: 240,
    windowMs: 60_000,
  });
  if (!allowed) return;

  try {
    if (req.method === 'GET') {
      const data = await getRealtimeSessionForUser(sessionId, session.user.id);
      if (!data) {
        return res.status(404).json({ message: 'Realtime-Session nicht gefunden' });
      }
      return res.status(200).json(data);
    }

    if (req.method === 'PATCH') {
      const requestedStatus = req.body?.status;
      const requestedTemplate = req.body?.documentTemplate;
      const updated = await updateRealtimeSessionMeta({
        sessionId,
        userId: session.user.id,
        title: req.body?.title,
        status: requestedStatus,
        documentTemplate: requestedTemplate,
      });
      if (!updated) {
        return res.status(403).json({ message: 'Keine Schreibberechtigung für diese Session' });
      }

      const data = await getRealtimeSessionForUser(sessionId, session.user.id);

      const finalizationState = data?.finalization_state || 'idle';
      if (
        (requestedStatus === 'completed' || requestedTemplate !== undefined)
        && data?.status === 'completed'
        && ['idle', 'failed'].includes(finalizationState)
      ) {
        queueMicrotask(() => {
          runRealtimeFinalization({ sessionId, userId: session.user.id }).catch((error) => {
            logApiError('Realtime finalization enqueue failed', error, { sessionId, userId: session.user.id });
          });
        });
      }

      await logAuditEvent({
        userId: session.user.id,
        action: 'realtime.meta_updated',
        targetType: 'realtime_session',
        targetId: String(sessionId),
        metadata: {
          status: requestedStatus || null,
          titleChanged: req.body?.title !== undefined,
          templateChanged: req.body?.documentTemplate !== undefined,
        },
      });
      return res.status(200).json(data);
    }

    return res.status(405).json({ message: 'Method not allowed' });
  } catch (error) {
    if (error?.message === 'INVALID_STATUS') {
      return res.status(400).json({ message: 'Ungültiger Status (active/paused/completed)' });
    }
    if (error?.message === 'INVALID_TEMPLATE') {
      return res.status(400).json({ message: 'Ungültige Dokument-Vorlage' });
    }
    logApiError('Realtime session item API error', error);
    return serverError(res, 'Realtime-Session konnte nicht aktualisiert werden');
  }
}
