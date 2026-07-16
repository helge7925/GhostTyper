import { enforceRateLimit, logApiError, serverError } from '../../../../lib/api-utils';
import { withOrgScope } from '../../../../lib/api/with-org-scope';
import { hasPermission } from '../../../../lib/permissions';
import { logAuditEvent } from '../../../../lib/audit-log';
import { getIntegration, redactConfig, upsertIntegration } from '../../../../lib/integrations';
import {
  DEFAULT_CHAT_MODEL,
  DEFAULT_CORTECS_BASE_URL,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_TRANSCRIPTION_MODEL,
} from '../../../../lib/constants';
import { resolveChatModel, resolveTranscriptionModel } from '../../../../lib/model-policy';

const PROVIDER = 'cortecs';

// Every field supports clearing via null/'' (upsertIntegration deletes
// null-valued keys, so the operator/env default takes over again). Invalid
// values are collected in `invalidFields` and rejected with a 400 instead
// of being silently dropped.
function pickConfigUpdate(body) {
  if (!body || typeof body !== 'object') return { update: {}, invalidFields: [] };
  const update = {};
  const invalidFields = [];

  if (Object.prototype.hasOwnProperty.call(body, 'apiKey')) {
    const value = body.apiKey;
    if (value === null || value === '') update.apiKey = null;
    else if (typeof value === 'string') update.apiKey = value.trim();
    else invalidFields.push('apiKey');
  }
  if (Object.prototype.hasOwnProperty.call(body, 'baseUrl')) {
    const value = body.baseUrl;
    if (value === null || value === '') update.baseUrl = null;
    else if (typeof value === 'string') update.baseUrl = value.trim().replace(/\/+$/, '');
    else invalidFields.push('baseUrl');
  }
  if (Object.prototype.hasOwnProperty.call(body, 'defaultChatModel')) {
    const value = body.defaultChatModel;
    if (value === null || value === '') {
      update.defaultChatModel = null;
    } else {
      const model = resolveChatModel(value, null);
      if (model) update.defaultChatModel = model;
      else invalidFields.push('defaultChatModel');
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'defaultTranscriptionModel')) {
    const value = body.defaultTranscriptionModel;
    if (value === null || value === '') {
      update.defaultTranscriptionModel = null;
    } else {
      const model = resolveTranscriptionModel(value, null);
      if (model) update.defaultTranscriptionModel = model;
      else invalidFields.push('defaultTranscriptionModel');
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'defaultEmbeddingModel')) {
    const value = body.defaultEmbeddingModel;
    if (value === null || value === '') {
      update.defaultEmbeddingModel = null;
    } else if (typeof value === 'string' && value.trim()) {
      update.defaultEmbeddingModel = value.trim().slice(0, 120);
    } else {
      invalidFields.push('defaultEmbeddingModel');
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'preference')) {
    const value = body.preference;
    if (value === null || value === '') {
      update.preference = null;
    } else if (['speed', 'cost', 'balanced'].includes(String(value).trim())) {
      update.preference = String(value).trim();
    } else {
      invalidFields.push('preference');
    }
  }

  return { update, invalidFields };
}

async function handler(req, res) {
  const orgId = req.org.id;
  const userId = req.userId;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'org-integrations-cortecs',
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
          operatorFallback: !!(process.env.CORTECS_API_KEY || process.env.VEXA_TRANSCRIPTION_TOKEN),
          defaults: {
            baseUrl: process.env.CORTECS_BASE_URL || DEFAULT_CORTECS_BASE_URL,
            defaultChatModel: process.env.CORTECS_CHAT_MODEL || DEFAULT_CHAT_MODEL,
            defaultEmbeddingModel: process.env.CORTECS_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL,
            defaultTranscriptionModel: process.env.CORTECS_TRANSCRIPTION_MODEL || DEFAULT_TRANSCRIPTION_MODEL,
            preference: process.env.CORTECS_PREFERENCE || 'balanced',
          },
          config: redactConfig(integration.config),
          updatedAt: integration.updatedAt || null,
        });
      } catch (error) {
        logApiError('Cortecs integration GET failed', error);
        return serverError(res, 'Cortecs-Konfiguration konnte nicht geladen werden.');
      }
    }
    case 'PUT': {
      if (!hasPermission(req.role, 'meeting.admin')) {
        return res.status(403).json({ code: 'FORBIDDEN', message: 'Keine Berechtigung.' });
      }
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const { update: partial, invalidFields } = pickConfigUpdate(body);
      if (invalidFields.length > 0) {
        return res.status(400).json({
          code: 'INVALID_FIELDS',
          message: `Ungültige Werte für: ${invalidFields.join(', ')}`,
          fields: invalidFields,
        });
      }
      const enabled = typeof body.enabled === 'boolean' ? body.enabled : undefined;

      try {
        const next = await upsertIntegration(orgId, PROVIDER, partial, enabled);
        await logAuditEvent({
          userId,
          organizationId: orgId,
          action: 'org.integration.cortecs.updated',
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
        logApiError('Cortecs integration PUT failed', error);
        return serverError(res, 'Cortecs-Konfiguration konnte nicht gespeichert werden.');
      }
    }
    default:
      res.setHeader('Allow', ['GET', 'PUT']);
      return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }
}

export default withOrgScope({ permission: 'org.read' }, handler);
