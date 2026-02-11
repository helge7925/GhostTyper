import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../auth/[...nextauth]';
import { query } from '../../../../lib/db';
import { addTranscriptionEvent, listTranscriptionEvents } from '../../../../lib/transcription-events';
import { logApiError } from '../../../../lib/api-utils';

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
  const staleStatuses = new Set(['processing', 'analyzing']);
  const updatedAt = new Date(transcription.updated_at).getTime();
  if (
    staleStatuses.has(transcription.status) &&
    Number.isFinite(updatedAt) &&
    Date.now() - updatedAt > 45 * 60 * 1000
  ) {
    await query(
      `UPDATE transcriptions
       SET status = 'error',
           error = 'Verarbeitung wurde unterbrochen. Bitte erneut starten.',
           updated_at = NOW()
       WHERE id = $1 AND user_id = $2`,
      [transcriptionId, userId]
    );
    transcription.status = 'error';
    transcription.error = 'Verarbeitung wurde unterbrochen. Bitte erneut starten.';
    transcription.updated_at = new Date().toISOString();
    await addTranscriptionEvent({
      transcriptionId,
      userId,
      stage: 'error',
      message: 'Verarbeitung wurde wegen Zeitüberschreitung als fehlerhaft markiert.',
    });
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

  const transId = Number.parseInt(req.query.id, 10);
  if (!Number.isFinite(transId)) {
    return res.status(400).json({ message: 'Ungültige ID' });
  }

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
    if (closed || res.writableEnded) return;

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

      if (!['pending', 'processing', 'analyzing'].includes(snapshot.status)) {
        cleanup();
      }
    } catch (error) {
      logApiError('Transcription stream error', error);
      writeSseEvent(res, 'error', { message: 'Stream-Update fehlgeschlagen' });
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
