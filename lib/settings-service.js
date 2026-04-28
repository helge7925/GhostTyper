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
    member_monthly_budget_limit
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

function withSettingsDefaults(settingsRow) {
  if (!settingsRow) return null;

  return {
    ...settingsRow,
    member_monthly_budget_limit: settingsRow.member_monthly_budget_limit ?? null,
  };
}

export async function getSettingsRow(userId) {
  try {
    const result = await query(SETTINGS_SELECT, [userId]);
    return withSettingsDefaults(result.rows[0] || null);
  } catch (error) {
    if (error?.code !== '42703') {
      throw error;
    }

    // Legacy DB schema fallback (before premium PDF columns existed).
    try {
      const legacyResult = await query(SETTINGS_SELECT_LEGACY, [userId]);
      return withSettingsDefaults(legacyResult.rows[0] || null);
    } catch (legacyError) {
      if (legacyError?.code !== '42703') {
        throw legacyError;
      }

      // Minimal fallback for very old schemas.
      const minimalResult = await query(SETTINGS_SELECT_MINIMAL, [userId]);
      return withSettingsDefaults(minimalResult.rows[0] || null);
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
