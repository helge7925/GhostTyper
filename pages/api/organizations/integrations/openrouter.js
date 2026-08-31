import { enforceRateLimit, logApiError, serverError } from '../../../../lib/api-utils';
import { withOrgScope } from '../../../../lib/api/with-org-scope';
import { hasPermission } from '../../../../lib/permissions';
import { logAuditEvent } from '../../../../lib/audit-log';
import { getIntegration, redactConfig, upsertIntegration } from '../../../../lib/integrations';
import { getOpenRouterCatalogue, modelsForCapability, normalizeOpenRouterConfig, OPENROUTER_CAPABILITIES, validateGovernanceConfig } from '../../../../lib/openrouter';

const PROVIDER = 'openrouter';

function pickUpdate(body) {
  const update = {};
  if (Object.prototype.hasOwnProperty.call(body, 'apiKey')) {
    update.apiKey = body.apiKey === '' || body.apiKey === null ? null : String(body.apiKey).trim();
  }
  for (const key of ['allowedModels', 'defaultModels', 'ttsVoices', 'liveTranscriptionVerified']) {
    if (Object.prototype.hasOwnProperty.call(body, key)) update[key] = body[key];
  }
  return update;
}

async function handler(req, res) {
  const orgId = req.org.id;
  const userId = req.userId;
  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'org-integrations-openrouter', identifier: `org:${orgId}:user:${userId}`, limit: 30, windowMs: 60_000,
  });
  if (!allowed) return;

  if (req.method === 'GET') {
    try {
      const integration = await getIntegration(orgId, PROVIDER);
      const config = normalizeOpenRouterConfig(integration.config || {});
      return res.status(200).json({
        provider: PROVIDER,
        enabled: integration.enabled,
        operatorFallback: Boolean(process.env.OPENROUTER_API_KEY),
        config: redactConfig(config),
        updatedAt: integration.updatedAt || null,
      });
    } catch (error) {
      logApiError('OpenRouter integration GET failed', error);
      return serverError(res, 'OpenRouter-Konfiguration konnte nicht geladen werden.');
    }
  }

  if (req.method === 'PUT') {
    if (!hasPermission(req.role, 'meeting.admin')) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Keine Berechtigung.' });
    }
    try {
      const existing = await getIntegration(orgId, PROVIDER);
      const partial = pickUpdate(req.body && typeof req.body === 'object' ? req.body : {});
      const candidate = { ...(existing.config || {}), ...partial };
      const { normalized, invalid } = validateGovernanceConfig(candidate);
      if (invalid.length) {
        return res.status(400).json({ code: 'INVALID_MODEL_GOVERNANCE', fields: invalid, message: 'Modellfreigaben oder Standards sind ungültig.' });
      }
      const changesGovernance = ['allowedModels', 'defaultModels', 'ttsVoices'].some((key) => Object.prototype.hasOwnProperty.call(partial, key));
      if (changesGovernance) {
        const apiKey = normalized.apiKey || process.env.OPENROUTER_API_KEY;
        if (!apiKey) return res.status(400).json({ code: 'NO_API_KEY', message: 'Ein OpenRouter-API-Key ist erforderlich.' });
        const catalogue = await getOpenRouterCatalogue({ apiKey, organizationId: orgId, allowStale: false });
        const unavailable = [];
        for (const capability of OPENROUTER_CAPABILITIES) {
          const compatible = new Set(modelsForCapability(catalogue.models, capability).map((model) => model.id));
          for (const model of normalized.allowedModels[capability]) {
            if (!compatible.has(model)) unavailable.push(`allowedModels.${capability}.${model}`);
          }
        }
        if (unavailable.length) {
          return res.status(409).json({ code: 'MODEL_CATALOGUE_MISMATCH', fields: unavailable, message: 'Mindestens ein Modell ist nicht mehr verfügbar oder inkompatibel.' });
        }
      }
      const next = await upsertIntegration(orgId, PROVIDER, normalized, existing.enabled);
      await logAuditEvent({
        userId, organizationId: orgId, action: 'org.integration.openrouter.updated',
        targetType: 'organization_integration', targetId: `${orgId}:${PROVIDER}`,
        metadata: { updatedFields: Object.keys(partial) },
      });
      return res.status(200).json({ provider: PROVIDER, enabled: next.enabled, config: redactConfig(next.config) });
    } catch (error) {
      if (error.code === 'ENCRYPTION_UNAVAILABLE') {
        return res.status(500).json({ code: error.code, message: 'SETTINGS_ENCRYPTION_KEY ist nicht konfiguriert.' });
      }
      if (error?.code === 'OPENROUTER_CATALOGUE_FAILED') {
        return res.status(503).json({ code: error.code, message: 'Der Live-Modellkatalog ist nicht verfügbar. Modelländerungen bleiben gesperrt.' });
      }
      logApiError('OpenRouter integration PUT failed', error);
      return serverError(res, 'OpenRouter-Konfiguration konnte nicht gespeichert werden.');
    }
  }

  res.setHeader('Allow', ['GET', 'PUT']);
  return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
}

export default withOrgScope({ permission: 'org.read' }, handler);
