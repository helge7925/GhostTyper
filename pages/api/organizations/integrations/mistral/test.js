import { enforceRateLimit, logApiError, fetchWithTimeout } from '../../../../../lib/api-utils';
import { withOrgScope } from '../../../../../lib/api/with-org-scope';
import { hasPermission } from '../../../../../lib/permissions';
import { logAuditEvent } from '../../../../../lib/audit-log';
import { resolveMistralApiKey } from '../../../../../lib/settings-service';

const PROVIDER = 'mistral';
const MISTRAL_MODELS_URL = 'https://api.mistral.ai/v1/models';

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
    keyPrefix: 'org-integrations-mistral-test',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 10,
    windowMs: 60_000,
  });
  if (!allowed) return;

  const apiKey = await resolveMistralApiKey({ userId, organizationId: orgId });
  if (!apiKey) {
    return res.status(400).json({ code: 'NO_API_KEY', message: 'Kein Mistral-API-Key gespeichert.' });
  }

  try {
    const response = await fetchWithTimeout(MISTRAL_MODELS_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    }, 8000);
    if (!response.ok) {
      throw new Error(`Mistral antwortete mit HTTP ${response.status}`);
    }
    const data = await response.json().catch(() => ({}));
    const sample = Array.isArray(data?.data) ? data.data.length : 0;
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: 'org.integration.mistral.tested',
      targetType: 'organization_integration',
      targetId: `${orgId}:${PROVIDER}`,
      metadata: { ok: true, sample },
    });
    return res.status(200).json({ ok: true, sample });
  } catch (error) {
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: 'org.integration.mistral.tested',
      targetType: 'organization_integration',
      targetId: `${orgId}:${PROVIDER}`,
      severity: 'warn',
      metadata: { ok: false, message: error.message },
    });
    logApiError('Mistral health check failed', error);
    return res.status(502).json({ code: 'MISTRAL_UNREACHABLE', message: error.message });
  }
}

export default withOrgScope({ permission: 'org.read' }, handler);
