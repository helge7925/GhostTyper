import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../auth/[...nextauth]';
import { enforceRateLimit, logApiError } from '../../../../../lib/api-utils';
import { getRealtimeSessionForUser } from '../../../../../lib/realtime-service';

const POLL_INTERVAL_MS = 1200;
const HEARTBEAT_MS = 15_000;

function parseSessionId(rawId) {
  const parsed = Number.parseInt(rawId, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function signature(snapshot) {
  return [
    snapshot?.updated_at || '',
    snapshot?.status || '',
    String(snapshot?.transcript_text?.length || 0),
    String(snapshot?.document_markdown?.length || 0),
    String(snapshot?.graph_json?.nodes?.length || 0),
    String(snapshot?.graph_json?.edges?.length || 0),
    snapshot?.document_template || '',
    snapshot?.finalization_state || '',
    snapshot?.finalized_at || '',
  ].join('|');
}

function writeEvent(res, eventName, payload) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const sessionId = parseSessionId(req.query.id);
  if (!sessionId) {
    return res.status(400).json({ message: 'Ungültige Session-ID' });
  }

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'realtime-session-stream',
    identifier: `user:${session.user.id}`,
    limit: 60,
    windowMs: 60_000,
  }, 'Zu viele Live-Verbindungen. Bitte später erneut versuchen.');
  if (!allowed) return;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }
  if (typeof req.socket?.setTimeout === 'function') {
    req.socket.setTimeout(0);
  }

  let closed = false;
  let lastSignature = '';
  let pollInFlight = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(pollTimer);
    clearInterval(heartbeatTimer);
    try {
      res.end();
    } catch {
      // ignore
    }
  };

  const pushSnapshot = async () => {
    if (closed || res.writableEnded || pollInFlight) return;
    pollInFlight = true;
    try {
      const snapshot = await getRealtimeSessionForUser(sessionId, session.user.id);
      if (!snapshot) {
        writeEvent(res, 'missing', { message: 'Realtime-Session nicht gefunden' });
        cleanup();
        return;
      }

      const nextSignature = signature(snapshot);
      if (nextSignature !== lastSignature) {
        lastSignature = nextSignature;
        writeEvent(res, 'snapshot', snapshot);
      }
    } catch (error) {
      logApiError('Realtime session stream error', error);
      writeEvent(res, 'error', { message: 'Stream-Update fehlgeschlagen' });
    } finally {
      pollInFlight = false;
    }
  };

  const heartbeatTimer = setInterval(() => {
    if (closed || res.writableEnded) return;
    res.write(': heartbeat\n\n');
  }, HEARTBEAT_MS);

  const pollTimer = setInterval(() => {
    pushSnapshot();
  }, POLL_INTERVAL_MS);

  req.on('close', cleanup);
  req.on('end', cleanup);
  req.on('aborted', cleanup);

  await pushSnapshot();
}
