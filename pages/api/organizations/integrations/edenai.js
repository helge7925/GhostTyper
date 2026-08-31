import { enforceRateLimit, logApiError, serverError } from '../../../../lib/api-utils.js';
import { withOrgScope } from '../../../../lib/api/with-org-scope.js';
import { hasPermission } from '../../../../lib/permissions.js';
import { logAuditEvent } from '../../../../lib/audit-log.js';
import { getIntegration, redactConfig, upsertIntegration } from '../../../../lib/integrations.js';
import { EDENAI_CAPABILITIES, EDENAI_HARDCODED_MODEL, normalizeEdenAiConfig } from '../../../../lib/edenai.js';

const PROVIDER = 'edenai';

function pickUpdate(body) {
  const update = {};
  if (Object.prototype.hasOwnProperty.call(body, 'apiKey')) {
    update.apiKey = body.apiKey === '' || body.apiKey === null ? null : String(body.apiKey).trim();
  }
  // Deliberately excludes `activatedCapabilities` — that field is only
  // ever set by activate.js on a successful per-capability probe/pricing
  // pass, never accepted from a plain config edit (see
  // lib/ai-provider-router.js's routing-safety comment). Models are no
  // longer admin-configurable at all (see hardcode-edenai-models) — only
  // `apiKey` and `ttsVoices` (a workspace preference, not a model
  // choice) remain editable.
  if (Object.prototype.hasOwnProperty.call(body, 'ttsVoices')) update.ttsVoices = body.ttsVoices;
  return update;
}

async function handler(req, res) {
  const orgId = req.org.id;
  const userId = req.userId;
  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'org-integrations-edenai', identifier: `org:${orgId}:user:${userId}`, limit: 30, windowMs: 60_000,
  });
  if (!allowed) return;

  if (req.method === 'GET') {
    try {
      const integration = await getIntegration(orgId, PROVIDER);
      const config = normalizeEdenAiConfig(integration.config || {});
      return res.status(200).json({
        provider: PROVIDER,
        enabled: integration.enabled,
        operatorFallback: Boolean(process.env.EDENAI_API_KEY),
        config: redactConfig(config),
        updatedAt: integration.updatedAt || null,
        capabilities: EDENAI_CAPABILITIES,
        hardcodedModels: EDENAI_HARDCODED_MODEL,
      });
    } catch (error) {
      logApiError('EdenAI integration GET failed', error);
      return serverError(res, 'EdenAI-Konfiguration konnte nicht geladen werden.');
    }
  }

  if (req.method === 'PUT') {
    if (!hasPermission(req.role, 'meeting.admin')) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Keine Berechtigung.' });
    }
    try {
      const existing = await getIntegration(orgId, PROVIDER);
      const partial = pickUpdate(req.body && typeof req.body === 'object' ? req.body : {});
      // Preserve activatedCapabilities across this edit — it is never
      // part of `partial`, but a plain object merge would otherwise be
      // fine to just carry it through unchanged from the stored config.
      const candidate = { ...(existing.config || {}), ...partial };
      const normalized = normalizeEdenAiConfig(candidate);
      const next = await upsertIntegration(orgId, PROVIDER, normalized, existing.enabled);
      await logAuditEvent({
        userId, organizationId: orgId, action: 'org.integration.edenai.updated',
        targetType: 'organization_integration', targetId: `${orgId}:${PROVIDER}`,
        metadata: { updatedFields: Object.keys(partial) },
      });
      return res.status(200).json({ provider: PROVIDER, enabled: next.enabled, config: redactConfig(next.config) });
    } catch (error) {
      if (error.code === 'ENCRYPTION_UNAVAILABLE') {
        return res.status(500).json({ code: error.code, message: 'SETTINGS_ENCRYPTION_KEY ist nicht konfiguriert.' });
      }
      logApiError('EdenAI integration PUT failed', error);
      return serverError(res, 'EdenAI-Konfiguration konnte nicht gespeichert werden.');
    }
  }

  res.setHeader('Allow', ['GET', 'PUT']);
  return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
}

export default withOrgScope({ permission: 'org.read' }, handler);
