import { enforceRateLimit, logApiError, serverError } from '../../../../lib/api-utils';
import { withOrgScope } from '../../../../lib/api/with-org-scope';
import { hasPermission } from '../../../../lib/permissions';
import { logAuditEvent } from '../../../../lib/audit-log';
import { getIntegration, redactConfig, upsertIntegration } from '../../../../lib/integrations';

const PROVIDER = 'mistral';

function pickConfigUpdate(body) {
  if (!body || typeof body !== 'object') return {};
  const update = {};
  if (Object.prototype.hasOwnProperty.call(body, 'apiKey')) {
    const value = body.apiKey;
    if (value === null || value === '') update.apiKey = null;
    else if (typeof value === 'string') update.apiKey = value.trim();
  }
  if (Object.prototype.hasOwnProperty.call(body, 'preferredModel')) {
    const value = body.preferredModel;
    if (value === null || value === '') update.preferredModel = null;
    else if (typeof value === 'string') update.preferredModel = value.trim();
  }
  return update;
}

async function handler(req, res) {
  const orgId = req.org.id;
  const userId = req.userId;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'org-integrations-mistral',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!allowed) return;

  switch (req.method) {
    case 'GET': {
      try {
        const integration = await getIntegration(orgId, PROVIDER);
        const operatorFallback = !!process.env.MISTRAL_API_KEY;
        return res.status(200).json({
          provider: PROVIDER,
          enabled: integration.enabled,
          operatorFallback,
          config: redactConfig(integration.config),
          updatedAt: integration.updatedAt || null,
        });
      } catch (error) {
        logApiError('Mistral integration GET failed', error);
        return serverError(res, 'Mistral-Konfiguration konnte nicht geladen werden.');
      }
    }
    case 'PUT': {
      if (!hasPermission(req.role, 'meeting.admin')) {
        return res.status(403).json({ code: 'FORBIDDEN', message: 'Keine Berechtigung.' });
      }
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const partial = pickConfigUpdate(body);
      const enabled = typeof body.enabled === 'boolean' ? body.enabled : undefined;

      try {
        const next = await upsertIntegration(orgId, PROVIDER, partial, enabled);
        await logAuditEvent({
          userId,
          organizationId: orgId,
          action: 'org.integration.mistral.updated',
          targetType: 'organization_integration',
          targetId: `${orgId}:${PROVIDER}`,
          metadata: { enabled: next.enabled, updatedFields: Object.keys(partial) },
        });
        return res.status(200).json({
          provider: PROVIDER,
          enabled: next.enabled,
          config: redactConfig(next.config),
        });
      } catch (error) {
        if (error.code === 'ENCRYPTION_UNAVAILABLE') {
          return res.status(500).json({
            code: 'ENCRYPTION_UNAVAILABLE',
            message: 'Server-seitige Verschlüsselung ist nicht konfiguriert (SETTINGS_ENCRYPTION_KEY).',
          });
        }
        logApiError('Mistral integration PUT failed', error);
        return serverError(res, 'Mistral-Konfiguration konnte nicht gespeichert werden.');
      }
    }
    default:
      res.setHeader('Allow', ['GET', 'PUT']);
      return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }
}

export default withOrgScope({ permission: 'org.read' }, handler);
