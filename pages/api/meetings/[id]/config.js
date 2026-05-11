import { query } from '../../../../lib/db';
import { enforceRateLimit, logApiError } from '../../../../lib/api-utils';
import { withOrgScope } from '../../../../lib/api/with-org-scope';
import { hasPermission } from '../../../../lib/permissions';
import { logAuditEvent } from '../../../../lib/audit-log';
import { addTranscriptionEvent } from '../../../../lib/transcription-events';
import { resolveVexaConfig } from '../../../../lib/integrations';
import { decryptSecret, SECRET_CONTEXTS } from '../../../../lib/secrets';
import { updateBotConfig } from '../../../../lib/api/vexa';

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
    keyPrefix: 'meetings-config',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!allowed) return;

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const language = typeof body.language === 'string' && body.language ? body.language : null;
  if (!language) {
    return res.status(400).json({ code: 'NO_FIELDS', message: 'Keine Felder zum Aktualisieren.' });
  }

  const result = await query(
    `SELECT user_id, source, meeting_platform, native_meeting_id, status, bot_status
       FROM transcriptions
      WHERE id = $1 AND organization_id = $2`,
    [transcriptionId, orgId],
  );
  if (!result.rows.length) return res.status(404).json({ code: 'NOT_FOUND' });
  const row = result.rows[0];
  if (row.source !== 'vexa') return res.status(400).json({ code: 'NOT_A_MEETING' });
  if (String(row.user_id) !== String(userId) && !hasPermission(req.role, 'transcription.write')) {
    return res.status(403).json({ code: 'FORBIDDEN' });
  }

  const integration = await resolveVexaConfig(orgId);
  const vexaConfig = integration.config;
  if (!vexaConfig.baseUrl) return res.status(400).json({ code: 'INTEGRATION_INCOMPLETE' });

  const tokenRow = await query(
    `SELECT api_key_encrypted FROM vexa_user_tokens WHERE user_id = $1 AND organization_id = $2`,
    [row.user_id, orgId],
  );
  const apiKey = tokenRow.rows.length
    ? decryptSecret(tokenRow.rows[0].api_key_encrypted, {
        field: SECRET_CONTEXTS.vexaUserToken,
        bindingId: orgId,
      })
    : null;
  if (!apiKey) return res.status(400).json({ code: 'NO_USER_TOKEN' });

  try {
    await updateBotConfig(
      { baseUrl: vexaConfig.baseUrl, apiKey },
      { platform: row.meeting_platform, nativeMeetingId: row.native_meeting_id, language },
    );
  } catch (error) {
    const upstream = error.response?.data?.message || error.response?.data?.detail || error.message;
    logApiError('Bot config update failed', error);
    return res.status(502).json({ code: 'VEXA_CONFIG_FAILED', message: upstream });
  }

  await addTranscriptionEvent({
    transcriptionId,
    userId,
    organizationId: orgId,
    stage: 'vexa_config',
    message: `Sprache auf ${language} umgestellt.`,
    meta: { language },
  });
  await logAuditEvent({
    userId,
    organizationId: orgId,
    action: 'meeting.bot.config',
    targetType: 'transcription',
    targetId: String(transcriptionId),
    metadata: { language },
  });

  return res.status(200).json({ ok: true, language });
}

export default withOrgScope({ permission: 'transcription.read' }, handler);
