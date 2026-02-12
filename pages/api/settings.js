import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';
import pool from '../../lib/db';
import {
  getSettingsRow,
  hasStoredApiKey,
  serializeApiKeyForStorage,
} from '../../lib/settings-service';
import { normalizeDefaultTemplate } from '../../lib/constants';
import { resolveChatModel, resolveOcrModel } from '../../lib/model-policy';
import { enforceRateLimit, logApiError, serverError } from '../../lib/api-utils';

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

function normalizeBoolean(value) {
  if (value === true || value === false) return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function normalizeOptionalText(value, maxLength) {
  if (value === null || value === undefined) {
    return { valid: true, value: null };
  }
  if (typeof value !== 'string') {
    return { valid: false, value: null };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { valid: true, value: null };
  }

  return {
    valid: true,
    value: trimmed.slice(0, maxLength),
  };
}

function addUpdate(updates, values, column, value) {
  updates.push(`${column} = $${values.length + 1}`);
  values.push(value);
}

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'api-settings',
    identifier: `user:${session.user.id}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!allowed) return;

  try {
    switch (req.method) {
      case 'GET': {
        const settings = await getSettingsRow(session.user.id);

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
            pdfPremiumEnabledDefault: false,
            pdfPremiumCompany: '',
            pdfPremiumName: '',
            pdfPremiumRole: '',
            pdfPremiumContact: '',
            pdfPremiumFooter: '',
          });
        }

        return res.status(200).json({
          apiKeyConfigured: hasStoredApiKey(settings),
          defaultTemplate: normalizeDefaultTemplate(settings.default_template),
          language: settings.language,
          contextBias: settings.context_bias || '',
          preferredModel: settings.preferred_model || 'mistral-large-latest',
          defaultTranslateLanguage: settings.default_translate_language || 'en',
          ocrModel: settings.ocr_model || 'mistral-ocr-latest',
          costLimit: settings.cost_limit,
          pdfPremiumEnabledDefault: Boolean(settings.pdf_premium_enabled_default),
          pdfPremiumCompany: settings.pdf_premium_company || '',
          pdfPremiumName: settings.pdf_premium_name || '',
          pdfPremiumRole: settings.pdf_premium_role || '',
          pdfPremiumContact: settings.pdf_premium_contact || '',
          pdfPremiumFooter: settings.pdf_premium_footer || '',
        });
      }

      case 'PUT': {
        const body = req.body || {};
        const {
          mistralApiKey,
          defaultTemplate,
          language,
          contextBias,
          preferredModel,
          costLimit,
          defaultTranslateLanguage,
          ocrModel,
          pdfPremiumEnabledDefault,
          pdfPremiumCompany,
          pdfPremiumName,
          pdfPremiumRole,
          pdfPremiumContact,
          pdfPremiumFooter,
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
        const shouldUpdateDefaultTranslateLanguage = hasOwnValue(body, 'defaultTranslateLanguage');
        const shouldUpdateOcrModel = hasOwnValue(body, 'ocrModel');

        const normalizedCostLimit = normalizeCostLimit(costLimit);
        if (shouldUpdateCostLimit && costLimit !== null && costLimit !== '' && normalizedCostLimit === null) {
          return res.status(400).json({ message: 'Ungültiges Kostenlimit' });
        }
        const shouldUpdatePdfPremiumEnabled = hasOwnValue(body, 'pdfPremiumEnabledDefault');
        const parsedPdfPremiumEnabled = shouldUpdatePdfPremiumEnabled
          ? normalizeBoolean(pdfPremiumEnabledDefault)
          : false;
        if (shouldUpdatePdfPremiumEnabled && parsedPdfPremiumEnabled === null) {
          return res.status(400).json({ message: 'Ungültige Premium-PDF-Option' });
        }

        const shouldUpdatePdfPremiumCompany = hasOwnValue(body, 'pdfPremiumCompany');
        const normalizedPdfPremiumCompany = shouldUpdatePdfPremiumCompany
          ? normalizeOptionalText(pdfPremiumCompany, 160)
          : { valid: true, value: null };
        if (!normalizedPdfPremiumCompany.valid) {
          return res.status(400).json({ message: 'Ungültiger Firmenname für Premium-PDF' });
        }

        const shouldUpdatePdfPremiumName = hasOwnValue(body, 'pdfPremiumName');
        const normalizedPdfPremiumName = shouldUpdatePdfPremiumName
          ? normalizeOptionalText(pdfPremiumName, 160)
          : { valid: true, value: null };
        if (!normalizedPdfPremiumName.valid) {
          return res.status(400).json({ message: 'Ungültiger Name für Premium-PDF' });
        }

        const shouldUpdatePdfPremiumRole = hasOwnValue(body, 'pdfPremiumRole');
        const normalizedPdfPremiumRole = shouldUpdatePdfPremiumRole
          ? normalizeOptionalText(pdfPremiumRole, 160)
          : { valid: true, value: null };
        if (!normalizedPdfPremiumRole.valid) {
          return res.status(400).json({ message: 'Ungültige Rolle für Premium-PDF' });
        }

        const shouldUpdatePdfPremiumContact = hasOwnValue(body, 'pdfPremiumContact');
        const normalizedPdfPremiumContact = shouldUpdatePdfPremiumContact
          ? normalizeOptionalText(pdfPremiumContact, 255)
          : { valid: true, value: null };
        if (!normalizedPdfPremiumContact.valid) {
          return res.status(400).json({ message: 'Ungültiger Kontakt für Premium-PDF' });
        }

        const shouldUpdatePdfPremiumFooter = hasOwnValue(body, 'pdfPremiumFooter');
        const normalizedPdfPremiumFooter = shouldUpdatePdfPremiumFooter
          ? normalizeOptionalText(pdfPremiumFooter, 255)
          : { valid: true, value: null };
        if (!normalizedPdfPremiumFooter.valid) {
          return res.status(400).json({ message: 'Ungültiger Footer für Premium-PDF' });
        }

        const client = await pool.connect();
        try {
          await client.query('BEGIN');

          await client.query(
            `INSERT INTO settings (user_id, updated_at)
             VALUES ($1, NOW())
             ON CONFLICT (user_id) DO NOTHING`,
            [session.user.id]
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
            addUpdate(updates, values, 'context_bias', contextBias ?? null);
          }
          if (shouldUpdatePreferredModel) {
            addUpdate(updates, values, 'preferred_model', preferredModel || null);
          }
          if (shouldUpdateCostLimit) {
            addUpdate(updates, values, 'cost_limit', normalizedCostLimit);
          }
          if (shouldUpdateDefaultTranslateLanguage) {
            addUpdate(updates, values, 'default_translate_language', defaultTranslateLanguage || null);
          }
          if (shouldUpdateOcrModel) {
            addUpdate(updates, values, 'ocr_model', ocrModel || null);
          }
          if (shouldUpdatePdfPremiumEnabled) {
            addUpdate(updates, values, 'pdf_premium_enabled_default', parsedPdfPremiumEnabled);
          }
          if (shouldUpdatePdfPremiumCompany) {
            addUpdate(updates, values, 'pdf_premium_company', normalizedPdfPremiumCompany.value);
          }
          if (shouldUpdatePdfPremiumName) {
            addUpdate(updates, values, 'pdf_premium_name', normalizedPdfPremiumName.value);
          }
          if (shouldUpdatePdfPremiumRole) {
            addUpdate(updates, values, 'pdf_premium_role', normalizedPdfPremiumRole.value);
          }
          if (shouldUpdatePdfPremiumContact) {
            addUpdate(updates, values, 'pdf_premium_contact', normalizedPdfPremiumContact.value);
          }
          if (shouldUpdatePdfPremiumFooter) {
            addUpdate(updates, values, 'pdf_premium_footer', normalizedPdfPremiumFooter.value);
          }

          if (updates.length > 0) {
            values.push(session.user.id);
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
