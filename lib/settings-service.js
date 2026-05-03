import { query } from './db';
import { decryptSecret, encryptSecret } from './secrets';
import { getIntegration } from './integrations';

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
    member_monthly_budget_limit,
    remote_meeting_enabled
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
    remote_meeting_enabled: settingsRow.remote_meeting_enabled ?? true,
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

/**
 * Three-tier resolution for the Mistral API key — admin-managed wins:
 *   1. organization_integrations[mistral].config.apiKey  (set by org admin)
 *   2. settings.mistral_api_key_encrypted (legacy, per-user)
 *   3. process.env.MISTRAL_API_KEY (operator default)
 *
 * Pass the active org id from the request (req.org.id) so the lookup is
 * scoped. Pass the user id so the legacy fallback works.
 */
export async function resolveMistralApiKey({ userId, organizationId } = {}) {
  if (organizationId) {
    try {
      const integration = await getIntegration(organizationId, 'mistral');
      if (integration.enabled && integration.config?.apiKey) {
        return integration.config.apiKey;
      }
    } catch {
      /* fall through */
    }
  }
  if (userId) {
    const settingsRow = await getSettingsRow(userId);
    const userKey = resolveStoredApiKey(settingsRow);
    if (userKey) return userKey;
  }
  return process.env.MISTRAL_API_KEY || null;
}

export async function isMistralOrgManaged(organizationId) {
  if (!organizationId) return false;
  try {
    const integration = await getIntegration(organizationId, 'mistral');
    return integration.enabled && Boolean(integration.config?.apiKey);
  } catch {
    return false;
  }
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
