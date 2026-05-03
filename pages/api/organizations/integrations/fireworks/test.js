import { enforceRateLimit, logApiError, fetchWithTimeout } from '../../../../../lib/api-utils';
import { withOrgScope } from '../../../../../lib/api/with-org-scope';
import { hasPermission } from '../../../../../lib/permissions';
import { logAuditEvent } from '../../../../../lib/audit-log';
import { resolveFireworksConfig } from '../../../../../lib/integrations';

const PROVIDER = 'fireworks';
const FIREWORKS_MODELS_URL = 'https://api.fireworks.ai/inference/v1/models';

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
    keyPrefix: 'org-integrations-fireworks-test',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 10,
    windowMs: 60_000,
  });
  if (!allowed) return;

  const effective = await resolveFireworksConfig();
  const apiKey = effective.apiKey;
  if (!apiKey) {
    return res.status(400).json({
      code: 'NO_API_KEY',
      message: 'Fireworks-API-Key ist nicht konfiguriert.',
    });
  }

  try {
    const response = await fetchWithTimeout(FIREWORKS_MODELS_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    }, 8000);
    if (!response.ok) {
      throw new Error(`Fireworks antwortete mit HTTP ${response.status}`);
    }
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: 'org.integration.fireworks.tested',
      targetType: 'organization_integration',
      targetId: `${orgId}:${PROVIDER}`,
      metadata: { ok: true },
    });
    return res.status(200).json({ ok: true });
  } catch (error) {
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: 'org.integration.fireworks.tested',
      targetType: 'organization_integration',
      targetId: `${orgId}:${PROVIDER}`,
      severity: 'warn',
      metadata: { ok: false, message: error.message },
    });
    logApiError('Fireworks health check failed', error);
    return res.status(502).json({ code: 'FIREWORKS_UNREACHABLE', message: error.message });
  }
}

export default withOrgScope({ permission: 'org.read' }, handler);
