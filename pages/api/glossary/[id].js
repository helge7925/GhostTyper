import { query } from '../../../lib/db';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { withOrgScope } from '../../../lib/api/with-org-scope';
import { hasPermission } from '../../../lib/permissions';
import { normalizeGlossaryPayload } from '../../../lib/translation-glossary-validation';

// See index.js: `personal` targets the caller's own rows (user_id = req.userId),
// anything else is the shared workspace list (user_id IS NULL).
function resolveScope(value) {
  const scope = String(Array.isArray(value) ? value[0] : value || '').trim().toLowerCase();
  return scope === 'personal' ? 'personal' : 'workspace';
}

async function handler(req, res) {
  const userId = req.userId;
  const orgId = req.org.id;
  const rawId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const id = /^\d+$/.test(String(rawId || '')) ? Number(rawId) : Number.NaN;
  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(400).json({ message: 'Ungültige Glossar-ID' });
  }

  // scope comes from the body on PUT and the query string on DELETE.
  const scope = resolveScope(req.body?.scope ?? req.query.scope);

  // Workspace mutations remain admin-only. Personal mutations are open to
  // every member but SQL-scoped to their own rows (user_id = req.userId), so a
  // member can never touch the workspace list or another user's personal list.
  if (scope === 'workspace' && !hasPermission(req.role, 'org.settings')) {
    return res.status(403).json({
      code: 'FORBIDDEN',
      message: 'Nur Workspace-Admins können Workspace-Glossareinträge verwalten.',
      permission: 'org.settings',
    });
  }

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'translation-glossary-entry',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!allowed) return;

  // Tier condition applied to every ownership/mutation query. Personal rows are
  // matched by owner; workspace rows require user_id IS NULL.
  const tierCondition = scope === 'personal' ? 'user_id = $3' : 'user_id IS NULL';
  const tierParams = scope === 'personal' ? [userId] : [];

  let ownerCheck;
  try {
    ownerCheck = await query(
      `SELECT id FROM translation_glossary
        WHERE id = $1 AND organization_id = $2 AND ${tierCondition}`,
      [id, orgId, ...tierParams]
    );
  } catch (error) {
    logApiError('Error checking translation glossary entry ownership', error);
    return serverError(res, 'Glossareintrag konnte nicht geladen werden');
  }
  if (ownerCheck.rows.length === 0) {
    return res.status(404).json({ message: 'Glossareintrag nicht gefunden' });
  }

  switch (req.method) {
    case 'PUT': {
      const { value, error } = normalizeGlossaryPayload(req.body);
      if (error) return res.status(400).json({ message: error });

      try {
        const result = await query(
          `UPDATE translation_glossary
            SET source_term = $1,
              target_lang = $2,
              target_term = $3,
              do_not_translate = $4,
              notes = $5,
              updated_at = NOW()
            WHERE id = $6 AND organization_id = $7 AND ${scope === 'personal' ? 'user_id = $8' : 'user_id IS NULL'}
            RETURNING id, organization_id, user_id, source_term, target_lang, target_term,
              do_not_translate, notes, created_at, updated_at`,
          [
            value.sourceTerm,
            value.targetLang,
            value.targetTerm,
            value.doNotTranslate,
            value.notes,
            id,
            orgId,
            ...(scope === 'personal' ? [userId] : []),
          ]
        );
        if (result.rows.length === 0) {
          return res.status(404).json({ message: 'Glossareintrag nicht gefunden' });
        }
        const row = result.rows[0];
        return res.status(200).json({ ...row, tier: row.user_id ? 'personal' : 'workspace' });
      } catch (error) {
        if (error?.code === '23505') {
          return res.status(409).json({ message: 'Dieser Glossareintrag existiert bereits.' });
        }
        logApiError('Error updating translation glossary entry', error);
        return serverError(res, 'Glossareintrag konnte nicht aktualisiert werden');
      }
    }

    case 'DELETE': {
      try {
        await query(
          `DELETE FROM translation_glossary
            WHERE id = $1 AND organization_id = $2 AND ${tierCondition}`,
          [id, orgId, ...tierParams]
        );
        return res.status(200).json({ success: true });
      } catch (error) {
        logApiError('Error deleting translation glossary entry', error);
        return serverError(res, 'Glossareintrag konnte nicht gelöscht werden');
      }
    }

    default:
      return res.status(405).json({ message: 'Method not allowed' });
  }
}

export default withOrgScope({ permission: 'org.read' }, handler);
