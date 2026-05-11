import crypto from 'crypto';
import { enforceRateLimit, logApiError, serverError } from '../../../../lib/api-utils';
import { withOrgScope } from '../../../../lib/api/with-org-scope';
import { hasPermission } from '../../../../lib/permissions';
import { logAuditEvent } from '../../../../lib/audit-log';
import { getIntegration, redactConfig, upsertIntegration } from '../../../../lib/integrations';

const PROVIDER = 'vexa';

// Vexa runs as a sibling container in the local Compose stack, so the
// base URL and admin token are operator-managed (set via VEXA_BASE_URL
// and VEXA_ADMIN_API_TOKEN in `.env`). They are intentionally not
// user-editable — keeping per-org overrides for these would just
// permit accidental misconfiguration toward a foreign Vexa instance.
const STRING_FIELDS = ['defaultBotName', 'defaultLanguage', 'transcriptionBackend', 'gdprChatNoticeText'];
const BOOL_FIELDS = ['gdprChatNoticeEnabled'];
const SECRET_FIELDS = ['webhookSecret'];

function pickConfigUpdate(body) {
  if (!body || typeof body !== 'object') return {};
  const update = {};
  for (const field of STRING_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      const value = body[field];
      if (value === null || value === '') {
        update[field] = null;
      } else if (typeof value === 'string') {
        update[field] = value.trim();
      }
    }
  }
  for (const field of BOOL_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      update[field] = body[field] === true;
    }
  }
  for (const field of SECRET_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      const value = body[field];
      if (value === null || value === '') {
        update[field] = null;
      } else if (typeof value === 'string') {
        update[field] = value;
      }
    }
  }
  return update;
}

async function handler(req, res) {
  const orgId = req.org.id;
  const userId = req.userId;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'org-integrations-vexa',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!allowed) return;

  switch (req.method) {
    case 'GET': {
      try {
        const integration = await getIntegration(orgId, PROVIDER);
        return res.status(200).json({
          provider: PROVIDER,
          enabled: integration.enabled,
          // The base URL and admin token are always operator-managed in
          // this build. We still emit `operatorManaged: true` for any
          // legacy clients that gate behaviour on it, but the UI no
          // longer surfaces those fields at all.
          operatorManaged: true,
          config: redactConfig(integration.config),
          updatedAt: integration.updatedAt || null,
        });
      } catch (error) {
        logApiError('Vexa integration GET failed', error);
        return serverError(res, 'Vexa-Konfiguration konnte nicht geladen werden.');
      }
    }

    case 'PUT': {
      if (!hasPermission(req.role, 'meeting.admin')) {
        return res.status(403).json({ code: 'FORBIDDEN', message: 'Keine Berechtigung.' });
      }
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const partial = pickConfigUpdate(body);
      const enabled = typeof body.enabled === 'boolean' ? body.enabled : undefined;

      // When the operator turns on the integration, auto-generate a webhook
      // secret so the org-admin never has to think about HMAC keys. Only
      // generated if neither the body nor existing config already has one.
      if (enabled === true && !partial.webhookSecret) {
        const existingIntegration = await getIntegration(orgId, PROVIDER);
        if (!existingIntegration.config?.webhookSecret) {
          partial.webhookSecret = `whsec_${crypto.randomBytes(32).toString('hex')}`;
        }
      }

      try {
        const next = await upsertIntegration(orgId, PROVIDER, partial, enabled);
        await logAuditEvent({
          userId,
          organizationId: orgId,
          action: 'org.integration.vexa.updated',
          targetType: 'organization_integration',
          targetId: `${orgId}:${PROVIDER}`,
          metadata: {
            enabled: next.enabled,
            updatedFields: Object.keys(partial),
          },
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
        logApiError('Vexa integration PUT failed', error);
        return serverError(res, 'Vexa-Konfiguration konnte nicht gespeichert werden.');
      }
    }

    default:
      res.setHeader('Allow', ['GET', 'PUT']);
      return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }
}

export default withOrgScope({ permission: 'org.read' }, handler);
