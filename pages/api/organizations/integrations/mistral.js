import { enforceRateLimit, logApiError, serverError } from '../../../../lib/api-utils.js';
import { withOrgScope } from '../../../../lib/api/with-org-scope.js';
import { hasPermission } from '../../../../lib/permissions.js';
import { logAuditEvent } from '../../../../lib/audit-log.js';
import { getIntegration, redactConfig, upsertIntegration } from '../../../../lib/integrations.js';
import { normalizeMistralConfig, MISTRAL_LIVE_TRANSCRIPTION_MODEL } from '../../../../lib/mistral.js';
import { findMissingMistralPrices } from '../../../../lib/mistral-pricing.js';

const PROVIDER = 'mistral';

function pickUpdate(body) {
  const update = {};
  if (Object.prototype.hasOwnProperty.call(body, 'apiKey')) {
    update.apiKey = body.apiKey === '' || body.apiKey === null ? null : String(body.apiKey).trim();
  }
  return update;
}

async function handler(req, res) {
  const orgId = req.org.id;
  const userId = req.userId;
  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'org-integrations-mistral', identifier: `org:${orgId}:user:${userId}`, limit: 30, windowMs: 60_000,
  });
  if (!allowed) return;

  if (req.method === 'GET') {
    try {
      const integration = await getIntegration(orgId, PROVIDER);
      const config = normalizeMistralConfig(integration.config || {});
      return res.status(200).json({
        provider: PROVIDER,
        operatorFallback: Boolean(process.env.MISTRAL_API_KEY),
        config: redactConfig(config),
        updatedAt: integration.updatedAt || null,
        // No catalogue, no admin model choice — one hardcoded model,
        // same "hardcode-edenai-models" philosophy applied here too.
        liveTranscriptionModel: MISTRAL_LIVE_TRANSCRIPTION_MODEL,
      });
    } catch (error) {
      logApiError('Mistral integration GET failed', error);
      return serverError(res, 'Mistral-Konfiguration konnte nicht geladen werden.');
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
      const normalized = normalizeMistralConfig(candidate);
      // A saved key is always active (see resolveMistralConfig's comment
      // — no enabled/disabled toggle), which makes this the one and only
      // "go live" moment for Mistral. Unlike EdenAI's activate.js, there
      // is no separate activation step to gate — so the pricing
      // pre-flight has to happen right here, before the key is ever
      // persisted, or a workspace could go live for real meetings with
      // no price row and no warning until billing broke mid-meeting.
      if (normalized.apiKey) {
        const missingPrices = await findMissingMistralPrices({ organizationId: orgId });
        if (missingPrices.length) {
          return res.status(400).json({
            code: 'PRICE_OVERRIDE_REQUIRED',
            missing: missingPrices,
            message: 'Für Mistral fehlt eine manuell hinterlegte Preiszeile (siehe /admin/prices). Der Key wird erst gespeichert, sobald sie existiert.',
          });
        }
      }
      const next = await upsertIntegration(orgId, PROVIDER, normalized, true);
      await logAuditEvent({
        userId, organizationId: orgId, action: 'org.integration.mistral.updated',
        targetType: 'organization_integration', targetId: `${orgId}:${PROVIDER}`,
        metadata: { updatedFields: Object.keys(partial) },
      });
      return res.status(200).json({ provider: PROVIDER, config: redactConfig(next.config) });
    } catch (error) {
      if (error.code === 'ENCRYPTION_UNAVAILABLE') {
        return res.status(500).json({ code: error.code, message: 'SETTINGS_ENCRYPTION_KEY ist nicht konfiguriert.' });
      }
      logApiError('Mistral integration PUT failed', error);
      return serverError(res, 'Mistral-Konfiguration konnte nicht gespeichert werden.');
    }
  }

  res.setHeader('Allow', ['GET', 'PUT']);
  return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
}

export default withOrgScope({ permission: 'org.read' }, handler);
