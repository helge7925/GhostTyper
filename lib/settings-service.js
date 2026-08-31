import { query } from './db.js';
import { getIntegration } from './integrations.js';
import { normalizeOpenRouterConfig, OPENROUTER_BASE_URL } from './openrouter.js';
import { normalizeEdenAiConfig, EDENAI_BASE_URL } from './edenai.js';
import { normalizeMistralConfig } from './mistral.js';

const SETTINGS_SELECT = `
  SELECT
    id,
    user_id,
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

export async function resolveOpenRouterConfig({ userId, organizationId, includeDisabled = false } = {}) {
  const operatorKey = process.env.OPENROUTER_API_KEY || null;
  if (organizationId) {
    try {
      const integration = await getIntegration(organizationId, 'openrouter');
      const config = normalizeOpenRouterConfig(integration.config || {});
      const usable = integration.enabled || includeDisabled;
      // Spread `config` first so the computed `apiKey`/`source` below
      // (which intentionally differ from `config.apiKey` in the
      // operator-fallback and disabled-integration cases) are not
      // silently overwritten by the object literal's later-key-wins rule.
      return {
        ...config,
        enabled: integration.enabled,
        apiKey: usable ? (config.apiKey || operatorKey) : null,
        baseUrl: OPENROUTER_BASE_URL,
        source: usable ? (config.apiKey ? 'workspace' : (operatorKey ? 'operator' : null)) : null,
        organizationId,
        userId: userId || null,
      };
    } catch {
      // Fall through to the operator configuration.
    }
  }
  return {
    ...normalizeOpenRouterConfig({}),
    enabled: false,
    apiKey: operatorKey,
    baseUrl: OPENROUTER_BASE_URL,
    source: operatorKey ? 'operator' : null,
    organizationId: organizationId || null,
    userId: userId || null,
  };
}

export async function resolveEdenAiConfig({ userId, organizationId, includeDisabled = false } = {}) {
  const operatorKey = process.env.EDENAI_API_KEY || null;
  if (organizationId) {
    try {
      const integration = await getIntegration(organizationId, 'edenai');
      const config = normalizeEdenAiConfig(integration.config || {});
      const usable = integration.enabled || includeDisabled;
      // Spread `config` first so the computed `apiKey`/`source` below
      // (which intentionally differ from `config.apiKey` in the
      // operator-fallback and disabled-integration cases) are not
      // silently overwritten by the object literal's later-key-wins rule.
      return {
        ...config,
        enabled: integration.enabled,
        apiKey: usable ? (config.apiKey || operatorKey) : null,
        baseUrl: EDENAI_BASE_URL,
        source: usable ? (config.apiKey ? 'workspace' : (operatorKey ? 'operator' : null)) : null,
        organizationId,
        userId: userId || null,
      };
    } catch {
      // Fall through to the operator configuration.
    }
  }
  return {
    ...normalizeEdenAiConfig({}),
    enabled: false,
    apiKey: operatorKey,
    baseUrl: EDENAI_BASE_URL,
    source: operatorKey ? 'operator' : null,
    organizationId: organizationId || null,
    userId: userId || null,
  };
}

// Direct Mistral integration (see lib/mistral.js) — no `enabled`/
// per-capability activation dance like EdenAI's, since there is exactly
// one Mistral-backed feature so far (live-meeting STT) and it isn't
// admin-toggled: it's the only path for that capability, not one option
// among several. `includeDisabled` is accepted for call-site symmetry
// with resolveOpenRouterConfig/resolveEdenAiConfig but has no separate
// "disabled" state to bypass yet.
export async function resolveMistralConfig({ userId, organizationId } = {}) {
  const operatorKey = process.env.MISTRAL_API_KEY || null;
  if (organizationId) {
    try {
      const integration = await getIntegration(organizationId, 'mistral');
      const config = normalizeMistralConfig(integration.config || {});
      return {
        ...config,
        apiKey: config.apiKey || operatorKey,
        source: config.apiKey ? 'workspace' : (operatorKey ? 'operator' : null),
        organizationId,
        userId: userId || null,
      };
    } catch {
      // Fall through to the operator configuration.
    }
  }
  return {
    ...normalizeMistralConfig({}),
    apiKey: operatorKey,
    source: operatorKey ? 'operator' : null,
    organizationId: organizationId || null,
    userId: userId || null,
  };
}
