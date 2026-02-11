import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';
import { query } from '../../lib/db';
import {
  getSettingsRow,
  hasStoredApiKey,
  serializeApiKeyForStorage,
} from '../../lib/settings-service';
import { resolveChatModel, resolveOcrModel } from '../../lib/model-policy';
import { checkRateLimit, applyRateLimitHeaders } from '../../lib/rate-limit';
import { logApiError, serverError } from '../../lib/api-utils';

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

function normalizeDefaultTemplate(value) {
  if (typeof value !== 'string') return 'generic';
  const template = value.trim();
  if (!template) return 'generic';

  // Product decision: summary is the default; meeting/aufmass stay selectable per job.
  if (template === 'generic') return 'generic';
  if (template.startsWith('custom-')) return template;
  return 'generic';
}

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const rate = checkRateLimit(req, {
    keyPrefix: 'api-settings',
    identifier: `user:${session.user.id}`,
    limit: 120,
    windowMs: 60_000,
  });
  applyRateLimitHeaders(res, rate);
  if (!rate.allowed) {
    return res.status(429).json({ message: 'Zu viele Anfragen. Bitte später erneut versuchen.' });
  }

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

        const shouldUpdateApiKey = mistralApiKey !== undefined;
        const shouldClearApiKey = shouldUpdateApiKey && (mistralApiKey === null || mistralApiKey === '');
        const shouldUpdateCostLimit = costLimit !== undefined;
        const normalizedDefaultTemplate = normalizeDefaultTemplate(defaultTemplate);
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

        const apiKeyPayload = shouldUpdateApiKey && !shouldClearApiKey
          ? serializeApiKeyForStorage(String(mistralApiKey).trim())
          : { encryptedApiKey: null, plainApiKey: null };

        await query(
          `INSERT INTO settings (
            user_id,
            mistral_api_key,
            mistral_api_key_encrypted,
            default_template,
            language,
            context_bias,
            preferred_model,
            cost_limit,
            default_translate_language,
            ocr_model,
            pdf_premium_enabled_default,
            pdf_premium_company,
            pdf_premium_name,
            pdf_premium_role,
            pdf_premium_contact,
            pdf_premium_footer,
            updated_at
          )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $15, $17, $19, $21, $23, $25, NOW())
           ON CONFLICT (user_id) DO UPDATE SET
             mistral_api_key = CASE
               WHEN $11 THEN NULL
               WHEN $12 THEN $2
               ELSE settings.mistral_api_key
             END,
             mistral_api_key_encrypted = CASE
               WHEN $11 THEN NULL
               WHEN $12 THEN $3
               ELSE settings.mistral_api_key_encrypted
             END,
             default_template = COALESCE($4, settings.default_template),
             language = COALESCE($5, settings.language),
             context_bias = $6,
             preferred_model = COALESCE($7, settings.preferred_model),
             cost_limit = CASE
               WHEN $13 THEN $8
               ELSE settings.cost_limit
             END,
             default_translate_language = COALESCE($9, settings.default_translate_language),
             ocr_model = COALESCE($10, settings.ocr_model),
             pdf_premium_enabled_default = CASE
               WHEN $14 THEN $15
               ELSE settings.pdf_premium_enabled_default
             END,
             pdf_premium_company = CASE
               WHEN $16 THEN $17
               ELSE settings.pdf_premium_company
             END,
             pdf_premium_name = CASE
               WHEN $18 THEN $19
               ELSE settings.pdf_premium_name
             END,
             pdf_premium_role = CASE
               WHEN $20 THEN $21
               ELSE settings.pdf_premium_role
             END,
             pdf_premium_contact = CASE
               WHEN $22 THEN $23
               ELSE settings.pdf_premium_contact
             END,
             pdf_premium_footer = CASE
               WHEN $24 THEN $25
               ELSE settings.pdf_premium_footer
             END,
             updated_at = NOW()`,
          [
            session.user.id,
            apiKeyPayload.plainApiKey,
            apiKeyPayload.encryptedApiKey,
            normalizedDefaultTemplate,
            language || null,
            contextBias ?? null,
            preferredModel || null,
            shouldUpdateCostLimit ? normalizedCostLimit : null,
            defaultTranslateLanguage || null,
            ocrModel || null,
            shouldClearApiKey,
            shouldUpdateApiKey,
            shouldUpdateCostLimit,
            shouldUpdatePdfPremiumEnabled,
            parsedPdfPremiumEnabled,
            shouldUpdatePdfPremiumCompany,
            normalizedPdfPremiumCompany.value,
            shouldUpdatePdfPremiumName,
            normalizedPdfPremiumName.value,
            shouldUpdatePdfPremiumRole,
            normalizedPdfPremiumRole.value,
            shouldUpdatePdfPremiumContact,
            normalizedPdfPremiumContact.value,
            shouldUpdatePdfPremiumFooter,
            normalizedPdfPremiumFooter.value,
          ]
        );

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
