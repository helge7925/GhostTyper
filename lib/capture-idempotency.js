import { query } from './db.js';
export {
  assertClientCaptureScope,
  normalizeClientCaptureId,
  isCaptureUniqueViolation,
} from './capture-idempotency-core.js';

export async function findCaptureReplay({ organizationId, userId, clientCaptureId }) {
  if (!clientCaptureId) return null;
  const result = await query(
    `SELECT id, filename, original_name, status, template, model, diarize,
            auto_analyze, created_at, text, analysis
       FROM transcriptions
      WHERE organization_id = $1
        AND user_id = $2
        AND client_capture_id = $3
      LIMIT 1`,
    [organizationId, userId, clientCaptureId],
  );
  return result.rows[0] || null;
}
