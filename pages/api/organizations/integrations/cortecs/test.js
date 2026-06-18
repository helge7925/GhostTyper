import { enforceRateLimit, logApiError, fetchWithTimeout } from '../../../../../lib/api-utils';
import { withOrgScope } from '../../../../../lib/api/with-org-scope';
import { hasPermission } from '../../../../../lib/permissions';
import { logAuditEvent } from '../../../../../lib/audit-log';
import { resolveCortecsConfig } from '../../../../../lib/settings-service';
import { buildCortecsBody } from '../../../../../lib/chat-stream-utils';

const PROVIDER = 'cortecs';

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }
  if (!hasPermission(req.role, 'meeting.admin')) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Keine Berechtigung.' });
  }

  const orgId = req.org.id;
  const userId = req.userId;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'org-integrations-cortecs-test',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 10,
    windowMs: 60_000,
  });
  if (!allowed) return;

  const config = await resolveCortecsConfig({ userId, organizationId: orgId });
  if (!config.apiKey) {
    return res.status(400).json({ code: 'NO_API_KEY', message: 'Kein Cortecs-API-Key gespeichert.' });
  }

  try {
    const response = await fetchWithTimeout(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(buildCortecsBody(config, [
        { role: 'system', content: 'Antworten Sie extrem kurz.' },
        { role: 'user', content: 'Healthcheck: antworten Sie nur mit OK.' },
      ])),
    }, 8000);
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Cortecs Chat antwortete mit HTTP ${response.status}: ${String(detail).slice(0, 160)}`);
    }
    const data = await response.json().catch(() => ({}));
    const sample = String(data?.choices?.[0]?.message?.content || '').slice(0, 40);
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: 'org.integration.cortecs.tested',
      targetType: 'organization_integration',
      targetId: `${orgId}:${PROVIDER}`,
      metadata: { ok: true, model: data?.model || config.chatModel },
    });
    return res.status(200).json({ ok: true, sample });
  } catch (error) {
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: 'org.integration.cortecs.tested',
      targetType: 'organization_integration',
      targetId: `${orgId}:${PROVIDER}`,
      severity: 'warn',
      metadata: { ok: false, message: error.message },
    });
    logApiError('Cortecs health check failed', error);
    return res.status(502).json({ code: 'CORTECS_UNREACHABLE', message: error.message });
  }
}

export default withOrgScope({ permission: 'org.read' }, handler);
