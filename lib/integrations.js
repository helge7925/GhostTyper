import { query } from './db';
import { encryptSecret, decryptSecret, SECRET_CONTEXTS } from './secrets';
import {
  DEFAULT_CORTECS_BASE_URL,
  DEFAULT_TRANSCRIPTION_MODEL,
} from './constants';
import { resolveTranscriptionModel } from './model-policy';

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
  'appPassword',
]);

function parseConfig(encrypted, organizationId) {
  if (!encrypted) return {};
  const decrypted = decryptSecret(encrypted, {
    field: SECRET_CONTEXTS.integrationConfig,
    bindingId: organizationId,
  });
  if (!decrypted) return {};
  try {
    const parsed = JSON.parse(decrypted);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function serializeConfig(configObject, organizationId) {
  if (!configObject || typeof configObject !== 'object') return null;
  const json = JSON.stringify(configObject);
  const encrypted = encryptSecret(json, {
    field: SECRET_CONTEXTS.integrationConfig,
    bindingId: organizationId,
  });
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
    config: parseConfig(row.config_encrypted, row.organization_id),
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
  const encrypted = serializeConfig(merged, organizationId);
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

/**
 * Resolve the effective Nextcloud (WebDAV) config for an org. Returns decrypted
 * secrets — server-side use only, never expose to the browser.
 */
export async function resolveNextcloudConfig(organizationId) {
  const integration = await getIntegration(organizationId, 'nextcloud');
  const cfg = integration.config || {};
  return {
    enabled: integration.enabled,
    baseUrl: cfg.baseUrl ? String(cfg.baseUrl).replace(/\/+$/, '') : null,
    username: cfg.username || null,
    appPassword: cfg.appPassword || null,
    targetFolder: cfg.targetFolder || 'GhostTyper',
  };
}

export async function deleteIntegration(organizationId, provider) {
  await query(
    `DELETE FROM organization_integrations WHERE organization_id = $1 AND provider = $2`,
    [organizationId, provider]
  );
}

const CORTECS_TRANSCRIPTION_DEFAULT_MODEL = DEFAULT_TRANSCRIPTION_MODEL;

/**
 * Resolve the effective transcription config for the live/Vexa bridge.
 *
 * Primary path: org-scoped Cortecs key from `organization_integrations`.
 * The caller can provide either `organizationId` directly, or meeting
 * coordinates (`platform` + `nativeMeetingId`) to resolve the org.
 *
 * The bridge container fetches this via the internal callback endpoint
 * each time it transcribes (cached for 60s on the bridge side).
 *
 * In addition to `apiKey`/`model`, this returns the workspace's globally
 * configured `contextBias` so the bridge can guide Whisper-compatible STT.
 */
async function resolveOrgFromMeeting(platform, nativeMeetingId) {
  if (!platform || !nativeMeetingId) return null;
  const result = await query(
    `SELECT organization_id
       FROM transcriptions
      WHERE source = 'vexa'
        AND meeting_platform = $1
        AND native_meeting_id = $2
      ORDER BY id DESC
      LIMIT 1`,
    [platform, nativeMeetingId],
  );
  return result.rows[0]?.organization_id || null;
}

export async function resolveBridgeTranscriptionConfig({ organizationId, platform, nativeMeetingId } = {}) {
  let scopedOrgId = organizationId || null;
  try {
    if (!scopedOrgId) {
      scopedOrgId = await resolveOrgFromMeeting(platform, nativeMeetingId);
    }
    if (scopedOrgId) {
      const scoped = await query(
        `SELECT i.config_encrypted, s.context_bias
           FROM organization_integrations i
           LEFT JOIN organization_settings s ON s.organization_id = i.organization_id
          WHERE i.organization_id = $1
            AND i.provider = 'cortecs'
            AND i.enabled = true
          LIMIT 1`,
        [scopedOrgId],
      );
      if (scoped.rows.length) {
        const row = scoped.rows[0];
        const cfg = parseConfig(row.config_encrypted, scopedOrgId);
        if (cfg.apiKey) {
          return {
            provider: 'cortecs',
            apiKey: cfg.apiKey,
            baseUrl: String(cfg.baseUrl || DEFAULT_CORTECS_BASE_URL).replace(/\/+$/, ''),
            model: resolveTranscriptionModel(cfg.defaultTranscriptionModel) || CORTECS_TRANSCRIPTION_DEFAULT_MODEL,
            contextBias: row.context_bias || '',
            source: 'workspace',
            organizationId: scopedOrgId,
          };
        }
      }
    }
  } catch {
    /* fall through to ENV */
  }

  const envKey = process.env.BRIDGE_TRANSCRIPTION_API_KEY
    || process.env.CORTECS_API_KEY
    || process.env.VEXA_TRANSCRIPTION_TOKEN
    || null;
  if (envKey) {
    return {
      provider: 'cortecs',
      apiKey: envKey,
      baseUrl: (process.env.CORTECS_BASE_URL || DEFAULT_CORTECS_BASE_URL).replace(/\/+$/, ''),
      model: resolveTranscriptionModel(process.env.CORTECS_TRANSCRIPTION_MODEL) || CORTECS_TRANSCRIPTION_DEFAULT_MODEL,
      contextBias: '',
      source: 'operator',
      organizationId: scopedOrgId || null,
    };
  }
  return {
    provider: 'cortecs',
    apiKey: null,
    baseUrl: (process.env.CORTECS_BASE_URL || DEFAULT_CORTECS_BASE_URL).replace(/\/+$/, ''),
    model: CORTECS_TRANSCRIPTION_DEFAULT_MODEL,
    contextBias: '',
    source: null,
    organizationId: scopedOrgId || null,
  };
}

/**
 * Resolve the effective Vexa config for an org.
 *
 * `baseUrl` and `adminToken` are operator-managed: they always come from
 * `VEXA_BASE_URL` and `VEXA_ADMIN_API_TOKEN` in the compose environment.
 * The per-org override that used to live next to them was removed from
 * the UI to keep operators from accidentally pointing one workspace at
 * a foreign Vexa instance — any legacy values still sitting in the
 * `organization_integrations` row are silently ignored here so old
 * deployments don't break, they just stop having an effect.
 *
 * Per-org settings the workspace admin still controls:
 *   - `webhookSecret`  — auto-generated on first enable
 *   - `defaultBotName` / `defaultLanguage`
 *   - `transcriptionBackend` (legacy hint, not actively read today)
 */
export async function resolveVexaConfig(organizationId) {
  const integration = await getIntegration(organizationId, 'vexa');
  const orgConfig = integration.config || {};
  const merged = {
    baseUrl: process.env.VEXA_BASE_URL || null,
    adminToken: process.env.VEXA_ADMIN_API_TOKEN || null,
    webhookSecret: orgConfig.webhookSecret || null,
    defaultBotName: orgConfig.defaultBotName || null,
    defaultLanguage: orgConfig.defaultLanguage || 'de',
    transcriptionBackend: orgConfig.transcriptionBackend || null,
    gdprChatNoticeEnabled: orgConfig.gdprChatNoticeEnabled === true,
    gdprChatNoticeText: orgConfig.gdprChatNoticeText || null,
  };
  return { enabled: integration.enabled, config: merged };
}
