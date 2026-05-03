import pool from '../../lib/db';
import { withOrgScope } from '../../lib/api/with-org-scope';
import {
  getSettingsRow,
  hasStoredApiKey,
  serializeApiKeyForStorage,
} from '../../lib/settings-service';
import { normalizeDefaultTemplate } from '../../lib/constants';
import { resolveChatModel, resolveOcrModel } from '../../lib/model-policy';
import { enforceRateLimit, logApiError, serverError } from '../../lib/api-utils';
import { logAuditEvent } from '../../lib/audit-log';

function normalizeCostLimit(costLimit) {
  if (costLimit === null || costLimit === '') return null;
  const value = Number(costLimit);
  if (!Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

function hasOwnValue(target, key) {
  return Object.prototype.hasOwnProperty.call(target || {}, key);
}

function normalizeContextBias(value) {
  if (value === null || value === undefined) {
    return { valid: true, value: null };
  }
  if (typeof value !== 'string') {
    return { valid: false, value: null };
  }

  const parts = value
    .split(/[\n,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  const seen = new Set();
  const unique = [];

  for (const part of parts) {
    const normalizedPart = part.slice(0, 80);
    const key = normalizedPart.toLocaleLowerCase('de-DE');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(normalizedPart);
  }

  if (unique.length === 0) {
    return { valid: true, value: null };
  }

  return {
    valid: true,
    value: unique.join(', '),
  };
}

function addUpdate(updates, values, column, value) {
  updates.push(`${column} = $${values.length + 1}`);
  values.push(value);
}

async function handler(req, res) {
  const userId = req.userId;
  const orgId = req.org.id;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'api-settings',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!allowed) return;

  try {
    switch (req.method) {
      case 'GET': {
        const settings = await getSettingsRow(userId);

        if (!settings) {
          return res.status(200).json({
            apiKeyConfigured: false,
            defaultTemplate: 'generic',
            language: 'de',
            contextBias: '',
            preferredModel: 'mistral-large-latest',
            defaultTranslateLanguage: 'en',
            ocrModel: 'mistral-ocr-latest',
            costLimit: null,
            memberMonthlyBudgetLimit: null,
            remoteMeetingEnabled: true,
          });
        }

        return res.status(200).json({
          apiKeyConfigured: hasStoredApiKey(settings),
          defaultTemplate: normalizeDefaultTemplate(settings.default_template),
          language: settings.language,
          contextBias: normalizeContextBias(settings.context_bias).value || '',
          preferredModel: settings.preferred_model || 'mistral-large-latest',
          defaultTranslateLanguage: settings.default_translate_language || 'en',
          ocrModel: settings.ocr_model || 'mistral-ocr-latest',
          costLimit: settings.cost_limit,
          memberMonthlyBudgetLimit: settings.member_monthly_budget_limit,
          remoteMeetingEnabled: settings.remote_meeting_enabled !== false,
        });
      }

      case 'PUT':
      case 'POST': {
        const body = req.body || {};
        const {
          mistralApiKey,
          defaultTemplate,
          language,
          contextBias,
          preferredModel,
          costLimit,
          memberMonthlyBudgetLimit,
          defaultTranslateLanguage,
          ocrModel,
          remoteMeetingEnabled,
        } = body;

        if (preferredModel !== undefined && resolveChatModel(preferredModel) === null) {
          return res.status(400).json({ message: 'Ungültiges KI-Modell' });
        }

        if (ocrModel !== undefined && resolveOcrModel(ocrModel) === null) {
          return res.status(400).json({ message: 'Ungültiges OCR-Modell' });
        }

        const shouldUpdateApiKey = hasOwnValue(body, 'mistralApiKey');
        const shouldClearApiKey = shouldUpdateApiKey && (mistralApiKey === null || mistralApiKey === '');
        const shouldUpdateDefaultTemplate = hasOwnValue(body, 'defaultTemplate');
        const shouldUpdateLanguage = hasOwnValue(body, 'language');
        const shouldUpdateContextBias = hasOwnValue(body, 'contextBias');
        const shouldUpdatePreferredModel = hasOwnValue(body, 'preferredModel');
        const shouldUpdateCostLimit = hasOwnValue(body, 'costLimit');
        const shouldUpdateMemberMonthlyBudgetLimit = hasOwnValue(body, 'memberMonthlyBudgetLimit');
        const shouldUpdateDefaultTranslateLanguage = hasOwnValue(body, 'defaultTranslateLanguage');
        const shouldUpdateOcrModel = hasOwnValue(body, 'ocrModel');
        const shouldUpdateRemoteMeetingEnabled = hasOwnValue(body, 'remoteMeetingEnabled');

        const normalizedCostLimit = normalizeCostLimit(costLimit);
        if (shouldUpdateCostLimit && costLimit !== null && costLimit !== '' && normalizedCostLimit === null) {
          return res.status(400).json({ message: 'Ungültiges Kostenlimit' });
        }
        const normalizedMemberMonthlyBudgetLimit = normalizeCostLimit(memberMonthlyBudgetLimit);
        if (
          shouldUpdateMemberMonthlyBudgetLimit
          && memberMonthlyBudgetLimit !== null
          && memberMonthlyBudgetLimit !== ''
          && normalizedMemberMonthlyBudgetLimit === null
        ) {
          return res.status(400).json({ message: 'Ungültiges Mitglieder-Budgetlimit' });
        }

        const normalizedContextBias = shouldUpdateContextBias
          ? normalizeContextBias(contextBias)
          : { valid: true, value: null };
        if (shouldUpdateContextBias && !normalizedContextBias.valid) {
          return res.status(400).json({ message: 'Ungültiges Format für Kontext-Wörter' });
        }

        const client = await pool.connect();
        const auditFlags = {
          apiKeyChanged: shouldUpdateApiKey,
          preferredModelChanged: shouldUpdatePreferredModel,
          costLimitChanged: shouldUpdateCostLimit,
          memberBudgetChanged: shouldUpdateMemberMonthlyBudgetLimit,
          contextBiasChanged: shouldUpdateContextBias,
        };
        try {
          await client.query('BEGIN');

          await client.query(
            `INSERT INTO settings (user_id, updated_at)
             VALUES ($1, NOW())
             ON CONFLICT (user_id) DO NOTHING`,
            [userId]
          );

          const updates = [];
          const values = [];

          if (shouldUpdateApiKey) {
            const apiKeyPayload = shouldClearApiKey
              ? { encryptedApiKey: null, plainApiKey: null }
              : serializeApiKeyForStorage(String(mistralApiKey).trim());
            addUpdate(updates, values, 'mistral_api_key', apiKeyPayload.plainApiKey);
            addUpdate(updates, values, 'mistral_api_key_encrypted', apiKeyPayload.encryptedApiKey);
          }

          if (shouldUpdateDefaultTemplate) {
            addUpdate(updates, values, 'default_template', normalizeDefaultTemplate(defaultTemplate));
          }
          if (shouldUpdateLanguage) {
            addUpdate(updates, values, 'language', language || null);
          }
          if (shouldUpdateContextBias) {
            addUpdate(updates, values, 'context_bias', normalizedContextBias.value);
          }
          if (shouldUpdatePreferredModel) {
            addUpdate(updates, values, 'preferred_model', preferredModel || null);
          }
          if (shouldUpdateCostLimit) {
            addUpdate(updates, values, 'cost_limit', normalizedCostLimit);
          }
          if (shouldUpdateMemberMonthlyBudgetLimit) {
            addUpdate(updates, values, 'member_monthly_budget_limit', normalizedMemberMonthlyBudgetLimit);
          }
          if (shouldUpdateDefaultTranslateLanguage) {
            addUpdate(updates, values, 'default_translate_language', defaultTranslateLanguage || null);
          }
          if (shouldUpdateOcrModel) {
            addUpdate(updates, values, 'ocr_model', ocrModel || null);
          }
          if (shouldUpdateRemoteMeetingEnabled) {
            addUpdate(updates, values, 'remote_meeting_enabled', remoteMeetingEnabled !== false);
          }

          if (updates.length > 0) {
            values.push(userId);
            await client.query(
              `UPDATE settings
               SET ${updates.join(', ')}, updated_at = NOW()
               WHERE user_id = $${values.length}`,
              values
            );
          }

          await client.query('COMMIT');
        } catch (writeError) {
          try {
            await client.query('ROLLBACK');
          } catch {
            // ignore rollback errors
          }
          throw writeError;
        } finally {
          client.release();
        }

        await logAuditEvent({
          userId: userId,
          action: 'settings.updated',
          targetType: 'settings',
          targetId: String(userId),
          metadata: auditFlags,
        });

        return res.status(200).json({ message: 'Einstellungen gespeichert' });
      }

      default:
        return res.status(405).json({ message: 'Method not allowed' });
    }
  } catch (error) {
    logApiError('Settings API error', error);
    if (error?.code === '42703') {
      return res.status(500).json({ message: 'Datenbank-Schema ist veraltet. Bitte DB-Init ausführen.' });
    }
    return serverError(res, 'Fehler beim Verarbeiten der Einstellungen');
  }
}

export default withOrgScope(handler);
