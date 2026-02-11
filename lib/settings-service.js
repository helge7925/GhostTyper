import { query } from './db';
import { decryptSecret, encryptSecret } from './secrets';

const SETTINGS_SELECT = `
  SELECT
    id,
    user_id,
    mistral_api_key,
    mistral_api_key_encrypted,
    default_template,
    language,
    context_bias,
    preferred_model,
    default_translate_language,
    ocr_model,
    cost_limit,
    pdf_premium_enabled_default,
    pdf_premium_company,
    pdf_premium_name,
    pdf_premium_role,
    pdf_premium_contact,
    pdf_premium_footer
  FROM settings
  WHERE user_id = $1
`;

const SETTINGS_SELECT_LEGACY = `
  SELECT
    id,
    user_id,
    mistral_api_key,
    mistral_api_key_encrypted,
    default_template,
    language,
    context_bias,
    preferred_model,
    default_translate_language,
    ocr_model,
    cost_limit
  FROM settings
  WHERE user_id = $1
`;

const SETTINGS_SELECT_MINIMAL = `
  SELECT *
  FROM settings
  WHERE user_id = $1
`;

function withPremiumDefaults(settingsRow) {
  if (!settingsRow) return null;

  return {
    ...settingsRow,
    pdf_premium_enabled_default: settingsRow.pdf_premium_enabled_default ?? false,
    pdf_premium_company: settingsRow.pdf_premium_company ?? null,
    pdf_premium_name: settingsRow.pdf_premium_name ?? null,
    pdf_premium_role: settingsRow.pdf_premium_role ?? null,
    pdf_premium_contact: settingsRow.pdf_premium_contact ?? null,
    pdf_premium_footer: settingsRow.pdf_premium_footer ?? null,
  };
}

export async function getSettingsRow(userId) {
  try {
    const result = await query(SETTINGS_SELECT, [userId]);
    return withPremiumDefaults(result.rows[0] || null);
  } catch (error) {
    if (error?.code !== '42703') {
      throw error;
    }

    // Legacy DB schema fallback (before premium PDF columns existed).
    try {
      const legacyResult = await query(SETTINGS_SELECT_LEGACY, [userId]);
      return withPremiumDefaults(legacyResult.rows[0] || null);
    } catch (legacyError) {
      if (legacyError?.code !== '42703') {
        throw legacyError;
      }

      // Minimal fallback for very old schemas.
      const minimalResult = await query(SETTINGS_SELECT_MINIMAL, [userId]);
      return withPremiumDefaults(minimalResult.rows[0] || null);
    }
  }
}

export function resolveStoredApiKey(settingsRow) {
  if (!settingsRow) return null;

  const decrypted = decryptSecret(settingsRow.mistral_api_key_encrypted);
  if (decrypted) return decrypted;

  return settingsRow.mistral_api_key || null;
}

export function hasStoredApiKey(settingsRow) {
  if (!settingsRow) return false;
  return Boolean(settingsRow.mistral_api_key_encrypted || settingsRow.mistral_api_key);
}

export function serializeApiKeyForStorage(rawApiKey) {
  if (!rawApiKey) {
    return { encryptedApiKey: null, plainApiKey: null };
  }

  const encryptedApiKey = encryptSecret(rawApiKey);
  if (encryptedApiKey) {
    return {
      encryptedApiKey,
      plainApiKey: null,
    };
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('SETTINGS_ENCRYPTION_KEY ist erforderlich, um API-Keys sicher zu speichern.');
  }

  // Development fallback for environments without encryption key material.
  return {
    encryptedApiKey: null,
    plainApiKey: rawApiKey,
  };
}
