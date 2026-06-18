import { query } from './db';
import { decryptSecret, encryptSecret, SECRET_CONTEXTS } from './secrets';
import { getIntegration } from './integrations';
import {
  DEFAULT_CHAT_MODEL,
  DEFAULT_CORTECS_BASE_URL,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_TRANSCRIPTION_MODEL,
} from './constants';
import { resolveChatModel, resolveTranscriptionModel } from './model-policy';

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

// Joined variant used when callers (e.g. the transcription worker) also
// need the workspace-global context bias. We expose it as
// `organization_context_bias` so it never collides with the per-user
// `context_bias` column.
const SETTINGS_SELECT_WITH_ORG_BIAS = `
  SELECT
    s.id,
    s.user_id,
    s.mistral_api_key,
    s.mistral_api_key_encrypted,
    s.default_template,
    s.language,
    s.context_bias,
    s.preferred_model,
    s.default_translate_language,
    s.ocr_model,
    s.cost_limit,
    s.member_monthly_budget_limit,
    s.remote_meeting_enabled,
    os.context_bias AS organization_context_bias
  FROM settings s
  LEFT JOIN organization_settings os ON os.organization_id = $2
  WHERE s.user_id = $1
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

export async function getSettingsRow(userId, { organizationId = null } = {}) {
  try {
    if (organizationId) {
      const joined = await query(SETTINGS_SELECT_WITH_ORG_BIAS, [userId, organizationId]);
      return withSettingsDefaults(joined.rows[0] || null);
    }
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

  const decrypted = decryptSecret(settingsRow.mistral_api_key_encrypted, {
    field: SECRET_CONTEXTS.mistralApiKey,
    bindingId: settingsRow.user_id,
  });
  if (decrypted) return decrypted;

  return settingsRow.mistral_api_key || null;
}

export function hasStoredApiKey(settingsRow) {
  if (!settingsRow) return false;
  return Boolean(settingsRow.mistral_api_key_encrypted || settingsRow.mistral_api_key);
}

/**
 * Workspace/operator resolution for the Mistral API key:
 *   1. organization_integrations[mistral].config.apiKey  (set by org admin)
 *   2. process.env.MISTRAL_API_KEY (operator default)
 *
 * Pass the active org id from the request (req.org.id) so the lookup is
 * scoped. Per-user API keys are intentionally not used for active config.
 */
export async function resolveMistralApiKey({ organizationId } = {}) {
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

export async function resolveCortecsConfig({ userId, organizationId } = {}) {
  const defaults = {
    apiKey: process.env.CORTECS_API_KEY || null,
    baseUrl: (process.env.CORTECS_BASE_URL || DEFAULT_CORTECS_BASE_URL).replace(/\/+$/, ''),
    chatModel: resolveChatModel(process.env.CORTECS_CHAT_MODEL) || DEFAULT_CHAT_MODEL,
    embeddingModel: process.env.CORTECS_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL,
    transcriptionModel: resolveTranscriptionModel(process.env.CORTECS_TRANSCRIPTION_MODEL) || DEFAULT_TRANSCRIPTION_MODEL,
    preference: process.env.CORTECS_PREFERENCE || 'balanced',
    source: process.env.CORTECS_API_KEY ? 'operator' : null,
  };

  if (organizationId) {
    try {
      const integration = await getIntegration(organizationId, 'cortecs');
      if (integration.enabled) {
        const cfg = integration.config || {};
        return {
          apiKey: cfg.apiKey || defaults.apiKey,
          baseUrl: String(cfg.baseUrl || defaults.baseUrl).replace(/\/+$/, ''),
          chatModel: resolveChatModel(cfg.defaultChatModel || defaults.chatModel) || defaults.chatModel,
          embeddingModel: cfg.defaultEmbeddingModel || defaults.embeddingModel,
          transcriptionModel: resolveTranscriptionModel(cfg.defaultTranscriptionModel || defaults.transcriptionModel) || defaults.transcriptionModel,
          preference: cfg.preference || defaults.preference,
          source: cfg.apiKey ? 'workspace' : defaults.source,
          organizationId,
          userId: userId || null,
        };
      }
    } catch {
      /* fall through to ENV */
    }
  }

  return {
    ...defaults,
    organizationId: organizationId || null,
    userId: userId || null,
  };
}

export function serializeApiKeyForStorage(rawApiKey, { userId } = {}) {
  if (!rawApiKey) {
    return { encryptedApiKey: null, plainApiKey: null };
  }

  const encryptedApiKey = encryptSecret(rawApiKey, {
    field: SECRET_CONTEXTS.mistralApiKey,
    bindingId: userId,
  });
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
