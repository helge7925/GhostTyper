import pool from '../../../../../lib/db';
import { withOrgScope } from '../../../../../lib/api/with-org-scope';
import { hasPermission } from '../../../../../lib/permissions';
import { logAuditEvent } from '../../../../../lib/audit-log';
import { getIntegration, upsertIntegration, disableAndClearIntegration } from '../../../../../lib/integrations';
import { getOpenRouterCatalogue, modelsForCapability, OPENROUTER_CAPABILITIES, validateGovernanceConfig } from '../../../../../lib/openrouter';
import { resolveOpenRouterConfig } from '../../../../../lib/settings-service';
import { syncAllowedOpenRouterPrices } from '../../../../../lib/openrouter-pricing';
import { probeOpenRouterDefaults } from '../../../../../lib/openrouter-probes';
import { logApiError } from '../../../../../lib/api-utils';

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }
  if (!hasPermission(req.role, 'meeting.admin')) return res.status(403).json({ code: 'FORBIDDEN' });
  try {
  const orgId = req.org.id;
  const integration = await getIntegration(orgId, 'openrouter');
  const { normalized, invalid } = validateGovernanceConfig(integration.config || {});
  const missing = OPENROUTER_CAPABILITIES.filter((capability) => !normalized.defaultModels[capability]);
  if (invalid.length || missing.length) {
    return res.status(400).json({ code: 'INTEGRATION_INCOMPLETE', fields: [...invalid, ...missing], message: 'Für jede Fähigkeit ist ein geprüfter Standard erforderlich.' });
  }
  const effective = await resolveOpenRouterConfig({ userId: req.userId, organizationId: orgId, includeDisabled: true });
  if (!effective.apiKey) return res.status(400).json({ code: 'NO_API_KEY' });
  const catalogue = await getOpenRouterCatalogue({ apiKey: effective.apiKey, organizationId: orgId, allowStale: false, force: true });
  for (const capability of OPENROUTER_CAPABILITIES) {
    const ids = new Set(modelsForCapability(catalogue.models, capability).map((model) => model.id));
    if (!ids.has(normalized.defaultModels[capability])) {
      return res.status(400).json({ code: 'DEFAULT_MODEL_UNAVAILABLE', capability, message: `Standardmodell für ${capability} ist nicht verfügbar.` });
    }
  }
  const probes = await probeOpenRouterDefaults({ apiKey: effective.apiKey, config: normalized, catalogue: catalogue.models });
  normalized.liveTranscriptionVerified = probes.liveTranscriptionVerified;
  const activatedAt = new Date().toISOString();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await syncAllowedOpenRouterPrices({ client, config: normalized, catalogue: catalogue.models, actorUserId: req.userId, effectiveFrom: activatedAt });
    await upsertIntegration(orgId, 'openrouter', { ...normalized, activatedAt }, true, { client });
    await disableAndClearIntegration(orgId, 'cortecs', { client });
    await disableAndClearIntegration(orgId, 'mistral', { client });
    await client.query(`UPDATE settings SET mistral_api_key = NULL, mistral_api_key_encrypted = NULL WHERE user_id IN (SELECT user_id FROM organization_members WHERE organization_id = $1)`, [orgId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  await logAuditEvent({ userId: req.userId, organizationId: orgId, action: 'org.integration.openrouter.activated', targetType: 'organization_integration', targetId: `${orgId}:openrouter`, metadata: { activatedAt, currencyMigration: 'EUR_NUMERIC_TO_USD', probeGenerationIds: probes.generationIds } });
  return res.status(200).json({ ok: true, activatedAt });
  } catch (error) {
    logApiError('OpenRouter activation failed', error);
    const safeCodes = new Set(['PRICE_OVERRIDE_REQUIRED', 'CAPABILITY_PROBE_FAILED', 'TTS_VOICE_REQUIRED', 'MODEL_UNAVAILABLE']);
    if (safeCodes.has(error?.code)) {
      return res.status(400).json({
        code: error.code,
        capability: error.capability || null,
        model: error.model || null,
        operation: error.operation || null,
        message: error.message,
      });
    }
    return res.status(502).json({ code: 'OPENROUTER_ACTIVATION_FAILED', message: 'OpenRouter konnte nicht aktiviert werden. Details wurden serverseitig protokolliert.' });
  }
}

export default withOrgScope({ permission: 'org.read' }, handler);
