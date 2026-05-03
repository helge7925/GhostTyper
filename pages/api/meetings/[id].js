import { query } from '../../../lib/db';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { withOrgScope } from '../../../lib/api/with-org-scope';
import { hasPermission } from '../../../lib/permissions';
import { logAuditEvent } from '../../../lib/audit-log';
import { addTranscriptionEvent } from '../../../lib/transcription-events';
import { resolveVexaConfig } from '../../../lib/integrations';
import { decryptSecret } from '../../../lib/secrets';
import { stopBot } from '../../../lib/api/vexa';

async function handler(req, res) {
  if (req.method !== 'DELETE') {
    res.setHeader('Allow', ['DELETE']);
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }
  if (!hasPermission(req.role, 'meeting.start')) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Keine Berechtigung.' });
  }

  const orgId = req.org.id;
  const userId = req.userId;
  const transcriptionId = Number(req.query.id);
  if (!Number.isFinite(transcriptionId)) {
    return res.status(400).json({ code: 'INVALID_ID' });
  }

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'meetings-stop',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!allowed) return;

  const result = await query(
    `SELECT id, user_id, source, meeting_platform, native_meeting_id, status, bot_status
       FROM transcriptions
      WHERE id = $1 AND organization_id = $2`,
    [transcriptionId, orgId],
  );
  if (!result.rows.length) {
    return res.status(404).json({ code: 'NOT_FOUND' });
  }
  const row = result.rows[0];
  if (row.source !== 'vexa') {
    return res.status(400).json({ code: 'NOT_A_MEETING' });
  }
  if (String(row.user_id) !== String(userId) && !hasPermission(req.role, 'transcription.delete')) {
    return res.status(403).json({ code: 'FORBIDDEN' });
  }

  const integration = await resolveVexaConfig(orgId);
  const vexaConfig = integration.config;
  if (!vexaConfig.baseUrl) {
    return res.status(400).json({ code: 'INTEGRATION_INCOMPLETE' });
  }

  const tokenRow = await query(
    `SELECT api_key_encrypted FROM vexa_user_tokens WHERE user_id = $1 AND organization_id = $2`,
    [row.user_id, orgId],
  );
  const apiKey = tokenRow.rows.length ? decryptSecret(tokenRow.rows[0].api_key_encrypted) : null;
  if (!apiKey) {
    return res.status(400).json({ code: 'NO_USER_TOKEN', message: 'Kein Vexa-Token für diesen Nutzer.' });
  }

  try {
    await stopBot(
      { baseUrl: vexaConfig.baseUrl, apiKey },
      { platform: row.meeting_platform, nativeMeetingId: row.native_meeting_id },
    );
  } catch (error) {
    const upstream = error.response?.data?.message || error.response?.data?.detail || error.message;
    if (error.response && error.response.status !== 404) {
      logApiError('Bot stop failed', error);
      return res.status(502).json({ code: 'VEXA_STOP_FAILED', message: upstream });
    }
  }

  await query(
    `UPDATE transcriptions SET bot_status = 'stopping', updated_at = NOW() WHERE id = $1`,
    [transcriptionId],
  );
  await addTranscriptionEvent({
    transcriptionId,
    userId,
    organizationId: orgId,
    stage: 'vexa_stop',
    message: 'Bot-Stop angefordert.',
  });
  await logAuditEvent({
    userId,
    organizationId: orgId,
    action: 'meeting.bot.stop',
    targetType: 'transcription',
    targetId: String(transcriptionId),
    metadata: { platform: row.meeting_platform, nativeMeetingId: row.native_meeting_id },
  });

  return res.status(200).json({ ok: true });
}

export default withOrgScope({ permission: 'transcription.read' }, handler);
