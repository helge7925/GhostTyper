import { enforceRateLimit, logApiError } from '../../../../../lib/api-utils.js';
import { withOrgScope } from '../../../../../lib/api/with-org-scope.js';
import { hasPermission } from '../../../../../lib/permissions.js';
import { logAuditEvent } from '../../../../../lib/audit-log.js';
import { EDENAI_BASE_URL, edenAiHeaders } from '../../../../../lib/edenai.js';
import { resolveEdenAiConfig } from '../../../../../lib/settings-service.js';

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }
  if (!hasPermission(req.role, 'meeting.admin')) return res.status(403).json({ code: 'FORBIDDEN' });
  const orgId = req.org.id;
  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'org-integrations-edenai-test', identifier: `org:${orgId}:user:${req.userId}`, limit: 10, windowMs: 60_000,
  });
  if (!allowed) return;
  const config = await resolveEdenAiConfig({ userId: req.userId, organizationId: orgId, includeDisabled: true });
  if (!config.apiKey) return res.status(400).json({ code: 'NO_API_KEY', message: 'Kein EdenAI-API-Key gespeichert.' });
  try {
    // Models are hardcoded now (see EDENAI_HARDCODED_MODEL) — this is
    // purely a "does this key authenticate" check, not a catalogue
    // browse. GET /v3/info (the flat feature listing, not a per-capability
    // catalogue) is the cheapest authenticated call available.
    const timeoutSignal = AbortSignal.timeout(12_000);
    const response = await fetch(`${EDENAI_BASE_URL}/info`, { headers: edenAiHeaders(config.apiKey), signal: timeoutSignal });
    if (!response.ok) {
      throw new Error(`EdenAI responded ${response.status}`);
    }
    await logAuditEvent({ userId: req.userId, organizationId: orgId, action: 'org.integration.edenai.tested', targetType: 'organization_integration', targetId: `${orgId}:edenai`, metadata: { ok: true } });
    return res.status(200).json({ ok: true });
  } catch (error) {
    logApiError('EdenAI health check failed', error);
    return res.status(502).json({ code: 'EDENAI_UNREACHABLE', message: 'EdenAI ist nicht erreichbar oder der API-Key ist ungültig.' });
  }
}

export default withOrgScope({ permission: 'org.read' }, handler);
