import { enforceRateLimit, logApiError } from '../../../../../lib/api-utils.js';
import { withOrgScope } from '../../../../../lib/api/with-org-scope.js';
import { hasPermission } from '../../../../../lib/permissions.js';
import { logAuditEvent } from '../../../../../lib/audit-log.js';
import { resolveMistralConfig } from '../../../../../lib/settings-service.js';

const MISTRAL_API_BASE_URL = 'https://api.mistral.ai/v1';

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }
  if (!hasPermission(req.role, 'meeting.admin')) return res.status(403).json({ code: 'FORBIDDEN' });
  const orgId = req.org.id;
  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'org-integrations-mistral-test', identifier: `org:${orgId}:user:${req.userId}`, limit: 10, windowMs: 60_000,
  });
  if (!allowed) return;
  const config = await resolveMistralConfig({ userId: req.userId, organizationId: orgId });
  if (!config.apiKey) return res.status(400).json({ code: 'NO_API_KEY', message: 'Kein Mistral-API-Key gespeichert.' });
  try {
    // A plain REST call (list models), not a realtime WebSocket
    // handshake — this only checks "does this key authenticate", not
    // the live-transcription path itself (that's exercised for real the
    // first time a meeting bridge chunk actually uses it).
    const timeoutSignal = AbortSignal.timeout(12_000);
    const response = await fetch(`${MISTRAL_API_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: timeoutSignal,
    });
    if (!response.ok) {
      throw new Error(`Mistral responded ${response.status}`);
    }
    await logAuditEvent({ userId: req.userId, organizationId: orgId, action: 'org.integration.mistral.tested', targetType: 'organization_integration', targetId: `${orgId}:mistral`, metadata: { ok: true } });
    return res.status(200).json({ ok: true });
  } catch (error) {
    logApiError('Mistral health check failed', error);
    return res.status(502).json({ code: 'MISTRAL_UNREACHABLE', message: 'Mistral ist nicht erreichbar oder der API-Key ist ungültig.' });
  }
}

export default withOrgScope({ permission: 'org.read' }, handler);
