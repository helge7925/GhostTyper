import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../auth/[...nextauth]';
import { query } from '../../../../lib/db';
import { addTranscriptionEvent, listTranscriptionEvents } from '../../../../lib/transcription-events';
import { enforceRateLimit, logApiError } from '../../../../lib/api-utils';
import { ensureTranscriptionWorkerRunning } from '../../../../lib/transcription-worker';
import {
  isStaleTranscription,
  recoverStaleTranscriptionById,
  STALE_TRANSCRIPTION_ERROR_MESSAGE,
  STALE_TRANSCRIPTION_EVENT_MESSAGE,
} from '../../../../lib/transcription-stale';

const POLL_INTERVAL_MS = 1500;
const HEARTBEAT_MS = 15000;

async function loadTranscriptionSnapshot(transcriptionId, userId) {
  const result = await query(
    `SELECT id, original_name, filename, status, template, diarize, auto_analyze, custom_prompt,
            mime_type, model, text, segments, speakers, analysis, error, folder_id, is_favorite,
            document_html, created_at, updated_at
     FROM transcriptions
     WHERE id = $1 AND user_id = $2`,
    [transcriptionId, userId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const transcription = result.rows[0];
  const updatedAt = new Date(transcription.updated_at).getTime();
  if (isStaleTranscription(transcription.status, updatedAt)) {
    const recovered = await recoverStaleTranscriptionById(transcriptionId, userId);
    if (recovered) {
      transcription.status = 'error';
      transcription.error = STALE_TRANSCRIPTION_ERROR_MESSAGE;
      transcription.updated_at = new Date().toISOString();
      await addTranscriptionEvent({
        transcriptionId,
        userId,
        stage: 'error',
        message: STALE_TRANSCRIPTION_EVENT_MESSAGE,
      });
    }
  }

  const events = await listTranscriptionEvents(transcriptionId, userId);
  transcription.events = events;
  return transcription;
}

function buildSnapshotSignature(snapshot) {
  const lastEventId = snapshot?.events?.length
    ? snapshot.events[snapshot.events.length - 1]?.id
    : 0;

  return [
    snapshot.status || '',
    snapshot.updated_at || '',
    snapshot.error || '',
    snapshot.analysis ? '1' : '0',
    snapshot.document_html ? '1' : '0',
    String(lastEventId || 0),
  ].join('|');
}

function writeSseEvent(res, eventName, payload) {
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
  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'transcription-stream',
    identifier: `user:${session.user.id}`,
    limit: 30,
    windowMs: 60_000,
  }, 'Zu viele Live-Verbindungen. Bitte später erneut versuchen.');
  if (!allowed) return;

  const transId = Number.parseInt(req.query.id, 10);
  if (!Number.isFinite(transId)) {
    return res.status(400).json({ message: 'Ungültige ID' });
  }

  ensureTranscriptionWorkerRunning();

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
    } catch (_) {
      // Ignore "write after end" race when client closes first.
    }
  };

  const pushSnapshot = async () => {
    if (closed || res.writableEnded || pollInFlight) return;
    pollInFlight = true;

    try {
      const snapshot = await loadTranscriptionSnapshot(transId, session.user.id);
      if (!snapshot) {
        writeSseEvent(res, 'missing', { message: 'Transkription nicht gefunden' });
        cleanup();
        return;
      }

      const signature = buildSnapshotSignature(snapshot);
      if (signature !== lastSignature) {
        lastSignature = signature;
        writeSseEvent(res, 'transcription', snapshot);
      }

      if (!['pending', 'queued', 'processing', 'analyzing'].includes(snapshot.status)) {
        cleanup();
      }
    } catch (error) {
      logApiError('Transcription stream error', error);
      writeSseEvent(res, 'error', { message: 'Stream-Update fehlgeschlagen' });
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
