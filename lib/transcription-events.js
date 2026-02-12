import { query } from './db';
import { logWarn } from './observability';

export async function addTranscriptionEvent({ transcriptionId, userId, stage, message, meta = null }) {
  if (!transcriptionId || !userId || !stage || !message) return;

  try {
    await query(
      `INSERT INTO transcription_events (transcription_id, user_id, stage, message, meta)
       VALUES ($1, $2, $3, $4, $5)`,
      [transcriptionId, userId, stage, message, meta ? JSON.stringify(meta) : null]
    );
  } catch (error) {
    logWarn('transcription_events.write_failed', { message: error?.message || 'unknown' });
  }
}

export async function listTranscriptionEvents(transcriptionId, userId, limit = 80) {
  if (!transcriptionId || !userId) return [];

  try {
    const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 200) : 80;
    const result = await query(
      `SELECT id, stage, message, meta, created_at
       FROM transcription_events
       WHERE transcription_id = $1 AND user_id = $2
       ORDER BY created_at ASC
       LIMIT $3`,
      [transcriptionId, userId, safeLimit]
    );
    return result.rows;
  } catch (error) {
    logWarn('transcription_events.read_failed', { message: error?.message || 'unknown' });
    return [];
  }
}
