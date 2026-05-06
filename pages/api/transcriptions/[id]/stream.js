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
import { withOrgScope } from '../../../../lib/api/with-org-scope';

const POLL_INTERVAL_MS = 1500;
const HEARTBEAT_MS = 15000;

async function loadTranscriptionSnapshot(transcriptionId, orgId, userId) {
  const result = await query(
    `SELECT id, original_name, filename, status, template, diarize, auto_analyze, custom_prompt,
            mime_type, model, text, segments, speakers, analysis, error, folder_id, is_favorite,
            document_html, created_at, updated_at, user_id,
            source, meeting_platform, native_meeting_id, external_meeting_id, bot_status,
            meeting_started_at, meeting_ended_at,
            translated_segments, translation_config
     FROM transcriptions
     WHERE id = $1 AND organization_id = $2`,
    [transcriptionId, orgId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const transcription = result.rows[0];
  const ownerId = transcription.user_id || userId;
  const updatedAt = new Date(transcription.updated_at).getTime();
  if (isStaleTranscription(transcription.status, updatedAt)) {
    const recovered = await recoverStaleTranscriptionById(transcriptionId, ownerId);
    if (recovered) {
      transcription.status = 'error';
      transcription.error = STALE_TRANSCRIPTION_ERROR_MESSAGE;
      transcription.updated_at = new Date().toISOString();
      await addTranscriptionEvent({
        transcriptionId,
        userId: ownerId,
        organizationId: orgId,
        stage: 'error',
        message: STALE_TRANSCRIPTION_EVENT_MESSAGE,
      });
    }
  }

  const events = await listTranscriptionEvents(transcriptionId, ownerId);
  transcription.events = events;
  return transcription;
}

function buildSnapshotSignature(snapshot) {
  const lastEventId = snapshot?.events?.length
    ? snapshot.events[snapshot.events.length - 1]?.id
    : 0;

  // Include translated_segments length so live-translation updates
  // trigger an SSE push even when no other field changed (the polled
  // updated_at gets bumped, but signing on length is cheaper than
  // hashing the full array each tick).
  const translatedCount = Array.isArray(snapshot.translated_segments)
    ? snapshot.translated_segments.length
    : 0;

  return [
    snapshot.status || '',
    snapshot.updated_at || '',
    snapshot.error || '',
    snapshot.analysis ? '1' : '0',
    snapshot.document_html ? '1' : '0',
    String(lastEventId || 0),
    `t${translatedCount}`,
  ].join('|');
}

function writeSseEvent(res, eventName, payload) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const userId = req.userId;
  const orgId = req.org.id;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'transcription-stream',
    identifier: `org:${orgId}:user:${userId}`,
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
      const snapshot = await loadTranscriptionSnapshot(transId, orgId, userId);
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

export default withOrgScope({ permission: 'transcription.read' }, handler);
