import { query } from './db.js';
import { trackStaleRecovery } from './observability.js';

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

/**
 * Sweeps stranded jobs across every user, for the background worker.
 *
 * The per-user variants above only run when someone opens the list, a detail
 * page or a stream — so a job stranded by a restart stayed "processing"
 * forever if its owner never came back, which is exactly what happens with
 * unattended API clients and the mobile field mode. This is the same rule,
 * just not waiting for an HTTP request to trigger it.
 *
 * `FOR UPDATE SKIP LOCKED` keeps two instances sweeping at once from fighting
 * over the same rows, and the batch limit bounds one sweep's work — a large
 * backlog drains over several passes instead of one long transaction.
 */
export async function recoverStaleTranscriptions({ limit = 200 } = {}) {
  const result = await query(
    `UPDATE transcriptions
     SET status = 'error',
         error = $1,
         updated_at = NOW()
     WHERE id IN (
       SELECT id
         FROM transcriptions
        WHERE status = ANY($2::text[])
          AND updated_at < NOW() - ($3::int * interval '1 millisecond')
        ORDER BY updated_at ASC
        LIMIT $4
        FOR UPDATE SKIP LOCKED
     )
     RETURNING id, user_id, organization_id`,
    [
      STALE_TRANSCRIPTION_ERROR_MESSAGE,
      STALE_TRANSCRIPTION_STATUSES,
      STALE_TRANSCRIPTION_TIMEOUT_MS,
      limit,
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
