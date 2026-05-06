import { enforceRateLimit, logApiError } from '../../../lib/api-utils';
import { resolveShareToken } from '../../../lib/share-tokens';

/**
 * Public snapshot for the live-translation companion view.
 *
 *   GET /api/share/:token
 *
 * No auth — the token *is* the capability. Returns only the fields a
 * passive viewer needs to render the two-column transcript and pick a
 * listen-language. Anything that could leak workspace or owner
 * identity is stripped out before responding.
 *
 * Unknown / expired token → 404 (not 401 — we don't want to leak the
 * existence of a row that just doesn't have an active share).
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'share-view',
    identifier: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'anon',
    limit: 120,
    windowMs: 60_000,
  });
  if (!allowed) return;

  const token = String(req.query.token || '').trim();
  let row;
  try {
    row = await resolveShareToken(token);
  } catch (error) {
    logApiError('share snapshot lookup failed', error);
    return res.status(500).json({ code: 'INTERNAL' });
  }
  if (!row) return res.status(404).json({ code: 'NOT_FOUND' });

  // Project ONLY translation-related fields. Hide id, user_id,
  // organization_id, original_name (might contain meeting URL or
  // workspace name), analysis, document_html, raw audio path.
  return res.status(200).json({
    status: row.status,
    segments: Array.isArray(row.segments) ? row.segments : [],
    translatedSegments: Array.isArray(row.translated_segments) ? row.translated_segments : [],
    translationConfig: row.translation_config || null,
    meetingStartedAt: row.meeting_started_at,
    meetingEndedAt: row.meeting_ended_at,
    expiresAt: row.public_share_expires_at,
  });
}
