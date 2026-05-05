import { query } from './db';

/**
 * Shared parsing/merging for context-bias term lists.
 *
 * Stored format (DB): comma-, semicolon- or newline-separated free text.
 * In-memory format: deduplicated string array.
 *
 * Both the per-user list (`settings.context_bias`) and the workspace-wide
 * list (`organization_settings.context_bias`) use this same helper so the
 * splitting and dedup behaviour stays in lockstep across batch and live
 * transcription paths.
 */

export function parseContextBias(value) {
  if (!value || typeof value !== 'string') return [];

  const parts = value
    .split(/[\n,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  const seen = new Set();
  const unique = [];
  for (const part of parts) {
    const key = part.toLocaleLowerCase('de-DE');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(part);
  }
  return unique;
}

/**
 * Merge multiple bias lists, preserving order of the first occurrence and
 * deduplicating case-insensitively. Inputs may be strings (raw DB values),
 * arrays of strings, or null/undefined.
 */
export function mergeContextBias(...sources) {
  const seen = new Set();
  const result = [];
  for (const src of sources) {
    const arr = Array.isArray(src) ? src : parseContextBias(src);
    for (const term of arr) {
      const key = String(term).trim();
      if (!key) continue;
      const norm = key.toLocaleLowerCase('de-DE');
      if (seen.has(norm)) continue;
      seen.add(norm);
      result.push(key);
    }
  }
  return result;
}

/**
 * Read the workspace-global context_bias for an organization.
 * Returns the raw stored string (or '' if not set).
 */
export async function getOrganizationContextBias(organizationId) {
  if (!organizationId) return '';
  try {
    const result = await query(
      'SELECT context_bias FROM organization_settings WHERE organization_id = $1',
      [organizationId],
    );
    return result.rows[0]?.context_bias || '';
  } catch {
    return '';
  }
}

/**
 * Pick the workspace-global context_bias for the most recently updated
 * `enabled` Mistral integration. The fireworks-bridge is not org-aware, so
 * a single workspace's bias must serve all live-transcription callers — we
 * align the choice with the same row that supplies the API key (jüngst
 * aktualisierte enabled Mistral-Integration gewinnt).
 */
export async function resolveBridgeContextBias() {
  try {
    const result = await query(
      `SELECT s.context_bias
         FROM organization_integrations i
         JOIN organization_settings s ON s.organization_id = i.organization_id
        WHERE i.provider = 'mistral' AND i.enabled = true
        ORDER BY i.updated_at DESC
        LIMIT 1`,
    );
    return parseContextBias(result.rows[0]?.context_bias);
  } catch {
    return [];
  }
}

