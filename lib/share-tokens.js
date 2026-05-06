import crypto from 'crypto';
import { query } from './db';

/**
 * Public share-tokens for the live-translation companion view.
 *
 * Trade-offs codified here:
 *
 * 1. **Scope is read-only translation, nothing else.** A holder of the
 *    token sees the original Voxtral segments + the translated segments
 *    + the translation_config (so they know which language pair). They
 *    do NOT see the raw audio file, the editor's document_html, the
 *    AI-analysis output, owner email, workspace name, or any settings.
 *    Each public endpoint that consumes a token re-projects only the
 *    fields that are safe to expose.
 *
 * 2. **Token is the capability — not the user.** No identity is
 *    attached. Every visitor with the URL gets the same view. Users
 *    with sensitive content should not enable sharing.
 *
 * 3. **Auto-expire prevents resurrection.** A token issued for a
 *    1-hour meeting auto-expires `meeting_end + 24 h` (configurable
 *    per call). Once expired, the row's `public_share_token` is wiped
 *    by the next cron / on-revoke; lookup-by-token falls through to
 *    404 even before that.
 *
 * 4. **Rotation by revocation.** Re-issuing a token replaces the
 *    previous one — old links break instantly. There's no chain of
 *    historical tokens; one row holds at most one active token.
 */

// 32 bytes random → 43-char URL-safe base64. Plenty of entropy and
// short enough to fit a Slack message comfortably.
const TOKEN_BYTES = 32;

export function generateShareToken() {
  return crypto
    .randomBytes(TOKEN_BYTES)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Mint or refresh a token for a transcription. Returns the token + the
 * new expiry timestamp. If `revoke` is set, clears the token instead
 * and returns nulls.
 */
export async function mintShareToken({ transcriptionId, organizationId, ttlHours = 24 }) {
  const token = generateShareToken();
  const expiresAt = new Date(Date.now() + ttlHours * 3_600_000);
  const result = await query(
    `UPDATE transcriptions
        SET public_share_token = $1,
            public_share_expires_at = $2,
            updated_at = NOW()
      WHERE id = $3 AND organization_id = $4
      RETURNING id`,
    [token, expiresAt, transcriptionId, organizationId],
  );
  if (result.rowCount === 0) {
    const err = new Error('TRANSCRIPTION_NOT_FOUND');
    err.code = 'NOT_FOUND';
    throw err;
  }
  return { token, expiresAt };
}

export async function revokeShareToken({ transcriptionId, organizationId }) {
  await query(
    `UPDATE transcriptions
        SET public_share_token = NULL,
            public_share_expires_at = NULL,
            updated_at = NOW()
      WHERE id = $1 AND organization_id = $2`,
    [transcriptionId, organizationId],
  );
}

/**
 * Look up the row a token grants access to. Returns null if the token
 * doesn't exist or has expired. The caller is responsible for
 * projecting only the safe-to-share fields onto its response.
 *
 * Token comparison is case-sensitive and uses an indexed equality
 * lookup on the unique partial index — no scan, no timing leak across
 * different transcriptions.
 */
export async function resolveShareToken(token) {
  if (!token || typeof token !== 'string') return null;
  // Defensive length filter — bogus inputs short-circuit before
  // hitting the DB.
  if (token.length < 16 || token.length > 64) return null;
  const result = await query(
    `SELECT id, organization_id, user_id, status, source, original_name,
            segments, speakers, translated_segments, translation_config,
            meeting_started_at, meeting_ended_at,
            public_share_expires_at
       FROM transcriptions
      WHERE public_share_token = $1
        AND public_share_expires_at IS NOT NULL
        AND public_share_expires_at > NOW()`,
    [token],
  );
  if (result.rows.length === 0) return null;
  return result.rows[0];
}
