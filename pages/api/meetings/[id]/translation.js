import { query } from '../../../../lib/db';
import { enforceRateLimit, logApiError } from '../../../../lib/api-utils';
import { withOrgScope } from '../../../../lib/api/with-org-scope';
import { hasPermission } from '../../../../lib/permissions';
import { logAuditEvent } from '../../../../lib/audit-log';
import { addTranscriptionEvent } from '../../../../lib/transcription-events';
import { ensureOverlayStarted, clearOverlay } from '../../../../lib/in-meeting-overlay';

/**
 * PUT /api/meetings/[id]/translation
 *
 * Toggle live-translation on a running meeting or swap the language
 * pair without restarting the bot. Body: `{ enabled, fromLang, toLang }`.
 *
 * Persisted to `transcriptions.translation_config`. The bridge picks up
 * the change at the next poll tick and starts (or stops) translating
 * incoming Voxtral segments — segments captured before the change keep
 * whatever translation state they already had.
 */
async function handler(req, res) {
  if (req.method !== 'PUT') {
    res.setHeader('Allow', ['PUT']);
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }
  if (!hasPermission(req.role, 'meeting.start')) {
    return res.status(403).json({ code: 'FORBIDDEN' });
  }

  const orgId = req.org.id;
  const userId = req.userId;
  const transcriptionId = Number(req.query.id);
  if (!Number.isFinite(transcriptionId)) {
    return res.status(400).json({ code: 'INVALID_ID' });
  }

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'meetings-translation',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!allowed) return;

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const wantEnabled = body.enabled === true;
  const fromLang = typeof body.fromLang === 'string' ? body.fromLang.slice(0, 8).trim() : '';
  const toLang = typeof body.toLang === 'string' ? body.toLang.slice(0, 8).trim() : '';
  // Overlay can only be enabled when translation is on. Pass `null`
  // (or omit the key) to leave it untouched; pass `true`/`false` to
  // explicitly toggle.
  const wantOverlayRaw = body.inMeetingOverlay;
  const overlayTouched = typeof wantOverlayRaw === 'boolean';
  const wantOverlay = wantEnabled && wantOverlayRaw === true;

  if (wantEnabled && (!fromLang || !toLang)) {
    return res.status(400).json({
      code: 'INVALID_LANGUAGES',
      message: 'fromLang und toLang sind beide erforderlich, wenn die Übersetzung aktiviert wird.',
    });
  }
  if (wantEnabled && fromLang === toLang) {
    return res.status(400).json({
      code: 'SAME_LANGUAGE',
      message: 'Quell- und Zielsprache müssen sich unterscheiden.',
    });
  }

  // Look up the row + ownership.
  const result = await query(
    `SELECT user_id, source, status FROM transcriptions
      WHERE id = $1 AND organization_id = $2`,
    [transcriptionId, orgId],
  );
  if (!result.rows.length) return res.status(404).json({ code: 'NOT_FOUND' });
  const row = result.rows[0];
  if (row.source !== 'vexa') return res.status(400).json({ code: 'NOT_A_MEETING' });
  if (String(row.user_id) !== String(userId) && !hasPermission(req.role, 'transcription.write')) {
    return res.status(403).json({ code: 'FORBIDDEN' });
  }

  const nextConfig = wantEnabled
    ? { enabled: true, fromLang, toLang, autoDetect: true }
    : null;

  try {
    if (overlayTouched) {
      await query(
        `UPDATE transcriptions
            SET translation_config = $1::jsonb,
                in_meeting_overlay_enabled = $2,
                updated_at = NOW()
          WHERE id = $3 AND organization_id = $4`,
        [nextConfig ? JSON.stringify(nextConfig) : null, wantOverlay, transcriptionId, orgId],
      );
    } else {
      await query(
        `UPDATE transcriptions
            SET translation_config = $1::jsonb,
                updated_at = NOW()
          WHERE id = $2 AND organization_id = $3`,
        [nextConfig ? JSON.stringify(nextConfig) : null, transcriptionId, orgId],
      );
    }
  } catch (error) {
    logApiError('Meeting translation update failed', error, { transcriptionId, orgId });
    return res.status(500).json({ code: 'UPDATE_FAILED' });
  }

  // Side-effects on the bot: if overlay was just turned ON (and
  // translation is also on) we trigger the screen-content POST. If
  // it was just turned OFF or translation was disabled entirely we
  // clear the overlay. Best-effort; failures don't break the flow.
  if (overlayTouched && wantOverlay) {
    await ensureOverlayStarted({
      transcriptionId,
      organizationId: orgId,
      forceRestart: true,
    }).catch((error) => {
      logApiError('Overlay start (manual toggle) failed', error, { transcriptionId, orgId });
    });
  } else if (overlayTouched && !wantOverlay) {
    await clearOverlay({ transcriptionId, organizationId: orgId }).catch(() => {});
  }
  // If translation got disabled entirely, the overlay is meaningless
  // — also clear it.
  if (!wantEnabled) {
    await clearOverlay({ transcriptionId, organizationId: orgId }).catch(() => {});
  }

  await addTranscriptionEvent({
    transcriptionId,
    userId,
    organizationId: orgId,
    stage: 'translation_config',
    message: wantEnabled
      ? `Live-Übersetzung aktiviert (${fromLang} ↔ ${toLang}).`
      : 'Live-Übersetzung deaktiviert.',
    meta: nextConfig || {},
  });
  await logAuditEvent({
    userId,
    organizationId: orgId,
    action: 'meeting.bot.translation',
    targetType: 'transcription',
    targetId: String(transcriptionId),
    metadata: { enabled: wantEnabled, fromLang: fromLang || null, toLang: toLang || null },
  });

  return res.status(200).json({
    ok: true,
    translation_config: nextConfig,
    in_meeting_overlay_enabled: overlayTouched ? wantOverlay : undefined,
  });
}

export default withOrgScope({ permission: 'transcription.read' }, handler);
