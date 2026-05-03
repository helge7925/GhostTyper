import { query } from './db';
import { encryptSecret, decryptSecret } from './secrets';

/**
 * Org-scoped third-party integration config (currently: Vexa Lite).
 *
 * Storage: `organization_integrations` table, one row per (org, provider).
 * The full provider-specific config object is JSON-serialized and stored
 * encrypted in `config_encrypted` so secrets never sit in plaintext at rest.
 *
 * Reads return the decrypted JSON; never expose the raw `config_encrypted`
 * value or any secret values to the browser.
 */

const REDACT_KEYS = new Set([
  'adminToken',
  'webhookSecret',
  'apiKey',
  'token',
  'secret',
]);

function parseConfig(encrypted) {
  if (!encrypted) return {};
  const decrypted = decryptSecret(encrypted);
  if (!decrypted) return {};
  try {
    const parsed = JSON.parse(decrypted);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function serializeConfig(configObject) {
  if (!configObject || typeof configObject !== 'object') return null;
  const json = JSON.stringify(configObject);
  const encrypted = encryptSecret(json);
  if (!encrypted) {
    const error = new Error('SETTINGS_ENCRYPTION_KEY is not configured.');
    error.code = 'ENCRYPTION_UNAVAILABLE';
    throw error;
  }
  return encrypted;
}

export async function getIntegration(organizationId, provider) {
  const result = await query(
    `SELECT id, organization_id, provider, enabled, config_encrypted, created_at, updated_at
       FROM organization_integrations
      WHERE organization_id = $1 AND provider = $2`,
    [organizationId, provider]
  );
  if (result.rows.length === 0) {
    return { exists: false, enabled: false, config: {} };
  }
  const row = result.rows[0];
  return {
    exists: true,
    id: row.id,
    enabled: !!row.enabled,
    config: parseConfig(row.config_encrypted),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Returns a redacted view of the config — secrets become `*_configured: true`
 * booleans. Use this for any value that is sent to the browser.
 */
export function redactConfig(config) {
  const out = {};
  const flags = {};
  for (const [key, value] of Object.entries(config || {})) {
    if (REDACT_KEYS.has(key)) {
      flags[`${key}Configured`] = !!value;
    } else {
      out[key] = value;
    }
  }
  return { ...out, ...flags };
}

/**
 * Upsert config + enabled flag. `partialConfig` is shallow-merged into the
 * existing config so callers can update individual fields without losing
 * unrelated ones (e.g. update the bot name without re-supplying the token).
 *
 * Pass `null` for a field to clear it.
 */
export async function upsertIntegration(organizationId, provider, partialConfig, enabled) {
  const existing = await getIntegration(organizationId, provider);
  const merged = { ...existing.config };
  if (partialConfig && typeof partialConfig === 'object') {
    for (const [key, value] of Object.entries(partialConfig)) {
      if (value === null) {
        delete merged[key];
      } else if (value !== undefined) {
        merged[key] = value;
      }
    }
  }
  const encrypted = serializeConfig(merged);
  const nextEnabled = typeof enabled === 'boolean' ? enabled : existing.enabled;

  await query(
    `INSERT INTO organization_integrations (organization_id, provider, enabled, config_encrypted, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     ON CONFLICT (organization_id, provider) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       config_encrypted = EXCLUDED.config_encrypted,
       updated_at = NOW()`,
    [organizationId, provider, nextEnabled, encrypted]
  );
  return { enabled: nextEnabled, config: merged };
}

export async function deleteIntegration(organizationId, provider) {
  await query(
    `DELETE FROM organization_integrations WHERE organization_id = $1 AND provider = $2`,
    [organizationId, provider]
  );
}

/**
 * Resolve the effective Fireworks Whisper config. The actual key lives in
 * exactly one place at runtime — for that reason this resolver does not
 * accept an orgId: it returns the system-wide effective key (any enabled
 * org integration overrides; otherwise the operator ENV key).
 *
 * The bridge container fetches this via the internal callback endpoint
 * each time it transcribes (cached for 60s on the bridge side).
 */
export async function resolveFireworksConfig() {
  // Pick the most-recently-updated enabled integration as the override.
  // In single-tenant deployments this is just the one workspace; in
  // multi-tenant the bridge serves all orgs anyway, so the operator-level
  // override wins by recency.
  try {
    const result = await query(
      `SELECT config_encrypted FROM organization_integrations
        WHERE provider = 'fireworks' AND enabled = true
        ORDER BY updated_at DESC
        LIMIT 1`,
    );
    if (result.rows.length) {
      const cfg = parseConfig(result.rows[0].config_encrypted);
      if (cfg.apiKey) {
        return { apiKey: cfg.apiKey, model: cfg.model || 'whisper-v3', source: 'workspace' };
      }
    }
  } catch {
    /* fall through */
  }
  const envKey = process.env.FIREWORKS_API_KEY || process.env.VEXA_TRANSCRIPTION_TOKEN || null;
  if (envKey) {
    return { apiKey: envKey, model: 'whisper-v3', source: 'operator' };
  }
  return { apiKey: null, model: 'whisper-v3', source: null };
}

/**
 * Resolve the effective Vexa config for an org by merging the per-org
 * settings with operator-level ENV fallbacks. Env-provided values back-fill
 * empty org fields; explicit org values always win.
 *
 * Operators running Vexa Lite alongside GhostTyper via docker-compose set
 * `VEXA_BASE_URL` and `VEXA_ADMIN_API_TOKEN` once in compose; orgs then
 * only toggle `enabled` and (optionally) provide a webhook secret.
 */
export async function resolveVexaConfig(organizationId) {
  const integration = await getIntegration(organizationId, 'vexa');
  const orgConfig = integration.config || {};
  const merged = {
    baseUrl: orgConfig.baseUrl || process.env.VEXA_BASE_URL || null,
    adminToken: orgConfig.adminToken || process.env.VEXA_ADMIN_API_TOKEN || null,
    webhookSecret: orgConfig.webhookSecret || null,
    defaultBotName: orgConfig.defaultBotName || null,
    defaultLanguage: orgConfig.defaultLanguage || 'de',
    transcriptionBackend: orgConfig.transcriptionBackend || null,
  };
  return { enabled: integration.enabled, config: merged };
}
