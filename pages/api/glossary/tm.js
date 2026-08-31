import { query } from '../../../lib/db';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { withOrgScope } from '../../../lib/api/with-org-scope';
import { hasPermission } from '../../../lib/permissions';
import { upsertVerifiedTM } from '../../../lib/translation-glossary';

// Translation-memory browser + review-correction endpoint (translation-excellence
// stages 2/3). Every statement is SQL-scoped to req.org.id so a member can only
// ever see or touch their own workspace's TM. Reading is open to every member
// (org.read); destructive actions (single delete, bulk purge) require admin
// (org.settings). POST writes a human-verified correction.

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(Array.isArray(value) ? value[0] : value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

// Escape LIKE wildcards so a user's search term is matched literally (default
// backslash escape char). Prevents `%`/`_` in the query from broadening the
// match unexpectedly.
function likeContains(term) {
  return `%${String(term).replace(/[\\%_]/g, '\\$&')}%`;
}

async function handleGet(req, res, orgId) {
  const rawQ = Array.isArray(req.query.q) ? req.query.q[0] : req.query.q;
  const q = String(rawQ || '').trim();
  const limit = clampInt(req.query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = clampInt(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);

  const result = await query(
    `SELECT id, source_lang, target_lang, source_text, target_text, verified,
        last_used_at, created_at, updated_at, COUNT(*) OVER() AS total_count
      FROM translation_memory
      WHERE organization_id = $1
        AND ($2::text IS NULL OR source_text ILIKE $2)
      ORDER BY verified DESC, (last_used_at IS NULL), last_used_at DESC, updated_at DESC
      LIMIT $3 OFFSET $4`,
    [orgId, q ? likeContains(q) : null, limit, offset]
  );

  const total = result.rows.length > 0 ? Number(result.rows[0].total_count) : 0;
  const entries = result.rows.map(({ total_count, ...row }) => row);
  return res.status(200).json({ entries, total, limit, offset });
}

async function handleDelete(req, res, orgId) {
  const purgeUnverified = String(
    Array.isArray(req.query.purgeUnverified) ? req.query.purgeUnverified[0] : req.query.purgeUnverified || ''
  ).toLowerCase() === 'true';

  if (purgeUnverified) {
    const result = await query(
      `DELETE FROM translation_memory
        WHERE organization_id = $1 AND verified = false`,
      [orgId]
    );
    return res.status(200).json({ success: true, purged: result.rowCount || 0 });
  }

  const rawId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const id = /^\d+$/.test(String(rawId || '')) ? Number(rawId) : Number.NaN;
  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(400).json({ message: 'Ungültige TM-ID' });
  }
  await query(
    `DELETE FROM translation_memory WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  );
  return res.status(200).json({ success: true });
}

async function handlePost(req, res, orgId) {
  const sourceLang = String(req.body?.sourceLang ?? req.body?.source_lang ?? '').trim();
  const targetLang = String(req.body?.targetLang ?? req.body?.target_lang ?? '').trim();
  const sourceText = String(req.body?.sourceText ?? req.body?.source_text ?? '');
  const targetText = String(req.body?.targetText ?? req.body?.target_text ?? '');

  if (!sourceLang || !targetLang || !sourceText.trim() || !targetText.trim()) {
    return res.status(400).json({ message: 'Quelltext, Zieltext und beide Sprachen sind erforderlich.' });
  }

  try {
    const stored = await upsertVerifiedTM(orgId, sourceLang, targetLang, sourceText, targetText);
    if (!stored) {
      return res.status(400).json({ message: 'Korrektur konnte nicht gespeichert werden.' });
    }
    return res.status(200).json({ success: true, verified: true });
  } catch (error) {
    logApiError('Translation memory correction store error', error);
    return serverError(res, 'Korrektur konnte nicht gespeichert werden');
  }
}

async function handler(req, res) {
  const userId = req.userId;
  const orgId = req.org.id;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'translation-memory',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!allowed) return;

  const requiresAdmin = req.method === 'DELETE';
  if (requiresAdmin && !hasPermission(req.role, 'org.settings')) {
    return res.status(403).json({
      code: 'FORBIDDEN',
      message: 'Nur Workspace-Admins können das Übersetzungsgedächtnis bereinigen.',
      permission: 'org.settings',
    });
  }

  try {
    switch (req.method) {
      case 'GET':
        return await handleGet(req, res, orgId);
      case 'POST':
        return await handlePost(req, res, orgId);
      case 'DELETE':
        return await handleDelete(req, res, orgId);
      default:
        return res.status(405).json({ message: 'Method not allowed' });
    }
  } catch (error) {
    logApiError('Translation memory browser error', error);
    return serverError(res, 'Übersetzungsgedächtnis konnte nicht geladen werden');
  }
}

export default withOrgScope({ permission: 'org.read' }, handler);
