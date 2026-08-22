import { enforceRateLimit, logApiError } from '../../../../../lib/api-utils';
import { withOrgScope } from '../../../../../lib/api/with-org-scope';
import { hasPermission } from '../../../../../lib/permissions';
import { logAuditEvent } from '../../../../../lib/audit-log';
import { getOpenRouterCatalogue, modelsForCapability } from '../../../../../lib/openrouter';
import { resolveOpenRouterConfig } from '../../../../../lib/settings-service';

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }
  if (!hasPermission(req.role, 'meeting.admin')) return res.status(403).json({ code: 'FORBIDDEN' });
  const orgId = req.org.id;
  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'org-integrations-openrouter-test', identifier: `org:${orgId}:user:${req.userId}`, limit: 10, windowMs: 60_000,
  });
  if (!allowed) return;
  const config = await resolveOpenRouterConfig({ userId: req.userId, organizationId: orgId, includeDisabled: true });
  if (!config.apiKey) return res.status(400).json({ code: 'NO_API_KEY', message: 'Kein OpenRouter-API-Key gespeichert.' });
  try {
    const catalogue = await getOpenRouterCatalogue({ apiKey: config.apiKey, organizationId: orgId, allowStale: false, force: true });
    const counts = Object.fromEntries(['chat', 'ocr', 'transcription', 'liveTranscription', 'tts']
      .map((capability) => [capability, modelsForCapability(catalogue.models, capability).length]));
    await logAuditEvent({ userId: req.userId, organizationId: orgId, action: 'org.integration.openrouter.tested', targetType: 'organization_integration', targetId: `${orgId}:openrouter`, metadata: { ok: true, counts } });
    return res.status(200).json({ ok: true, counts, fetchedAt: catalogue.fetchedAt });
  } catch (error) {
    logApiError('OpenRouter health check failed', error);
    return res.status(502).json({ code: 'OPENROUTER_UNREACHABLE', message: 'OpenRouter ist nicht erreichbar oder der API-Key ist ungültig.' });
  }
}

export default withOrgScope({ permission: 'org.read' }, handler);
