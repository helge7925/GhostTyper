import { query } from './db';
import { trackStaleRecovery } from './observability';

export const STALE_TRANSCRIPTION_TIMEOUT_MS = 45 * 60 * 1000;
export const STALE_TRANSCRIPTION_STATUSES = ['queued', 'processing', 'analyzing'];
export const STALE_TRANSCRIPTION_ERROR_MESSAGE = 'Verarbeitung wurde unterbrochen. Bitte erneut starten.';
export const STALE_TRANSCRIPTION_EVENT_MESSAGE = 'Verarbeitung wurde wegen Zeitüberschreitung als fehlerhaft markiert.';

export function isStaleTranscription(status, updatedAtMs) {
  if (!STALE_TRANSCRIPTION_STATUSES.includes(status)) return false;
  if (!Number.isFinite(updatedAtMs)) return false;
  return Date.now() - updatedAtMs > STALE_TRANSCRIPTION_TIMEOUT_MS;
}

export async function recoverStaleTranscriptionsForUser(userId) {
  const result = await query(
    `UPDATE transcriptions
     SET status = 'error',
         error = $2,
         updated_at = NOW()
     WHERE user_id = $1
       AND status = ANY($3::text[])
       AND updated_at < NOW() - ($4::int * interval '1 millisecond')
     RETURNING id`,
    [
      userId,
      STALE_TRANSCRIPTION_ERROR_MESSAGE,
      STALE_TRANSCRIPTION_STATUSES,
      STALE_TRANSCRIPTION_TIMEOUT_MS,
    ]
  );

  trackStaleRecovery(result.rows.length);
  return result.rows;
}

export async function recoverStaleTranscriptionById(transcriptionId, userId) {
  const result = await query(
    `UPDATE transcriptions
     SET status = 'error',
         error = $3,
         updated_at = NOW()
     WHERE id = $1
       AND user_id = $2
       AND status = ANY($4::text[])
       AND updated_at < NOW() - ($5::int * interval '1 millisecond')
     RETURNING id`,
    [
      transcriptionId,
      userId,
      STALE_TRANSCRIPTION_ERROR_MESSAGE,
      STALE_TRANSCRIPTION_STATUSES,
      STALE_TRANSCRIPTION_TIMEOUT_MS,
    ]
  );

  if (result.rowCount > 0) {
    trackStaleRecovery(1);
    return true;
  }

  return false;
}
