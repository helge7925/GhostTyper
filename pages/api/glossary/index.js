import { query } from '../../../lib/db';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { withOrgScope } from '../../../lib/api/with-org-scope';
import { hasPermission } from '../../../lib/permissions';
import { normalizeGlossaryPayload } from '../../../lib/translation-glossary-validation';

// Two-tier glossary scope. `workspace` (default) = the shared, admin-curated
// company terminology (rows with user_id IS NULL). `personal` = the caller's
// own working vocabulary (rows with user_id = req.userId). Anything other than
// an explicit `personal` resolves to workspace for backward compatibility.
function resolveScope(value) {
  const scope = String(Array.isArray(value) ? value[0] : value || '').trim().toLowerCase();
  return scope === 'personal' ? 'personal' : 'workspace';
}

async function handler(req, res) {
  const userId = req.userId;
  const orgId = req.org.id;
  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'translation-glossary',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!allowed) return;

  switch (req.method) {
    case 'GET': {
      const scope = resolveScope(req.query.scope);
      try {
        // Personal scope is SQL-scoped to the caller; workspace scope is the
        // org-wide shared list (user_id IS NULL). Members may read both.
        const result = scope === 'personal'
          ? await query(
            `SELECT id, organization_id, user_id, source_term, target_lang, target_term,
                do_not_translate, notes, created_at, updated_at
              FROM translation_glossary
              WHERE organization_id = $1 AND user_id = $2
              ORDER BY lower(source_term) ASC, target_lang ASC NULLS FIRST, id ASC`,
            [orgId, userId]
          )
          : await query(
            `SELECT id, organization_id, user_id, source_term, target_lang, target_term,
                do_not_translate, notes, created_at, updated_at
              FROM translation_glossary
              WHERE organization_id = $1 AND user_id IS NULL
              ORDER BY lower(source_term) ASC, target_lang ASC NULLS FIRST, id ASC`,
            [orgId]
          );
        return res.status(200).json({
          scope,
          entries: result.rows.map((row) => ({ ...row, tier: row.user_id ? 'personal' : 'workspace' })),
        });
      } catch (error) {
        logApiError('Error fetching translation glossary', error);
        return serverError(res, 'Glossar konnte nicht geladen werden');
      }
    }

    case 'POST': {
      const scope = resolveScope(req.body?.scope);
      // Workspace writes remain admin-only; personal writes are open to every
      // org member (the org.read wrapper already gate-kept membership).
      if (scope === 'workspace' && !hasPermission(req.role, 'org.settings')) {
        return res.status(403).json({
          code: 'FORBIDDEN',
          message: 'Nur Workspace-Admins können Workspace-Glossareinträge verwalten.',
          permission: 'org.settings',
        });
      }

      const { value, error } = normalizeGlossaryPayload(req.body);
      if (error) return res.status(400).json({ message: error });

      // Never trust a client-supplied user id: personal rows are always owned
      // by the caller, workspace rows always have user_id NULL.
      const ownerUserId = scope === 'personal' ? userId : null;

      try {
        const result = await query(
          `INSERT INTO translation_glossary (
              organization_id,
              user_id,
              source_term,
              target_lang,
              target_term,
              do_not_translate,
              notes
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id, organization_id, user_id, source_term, target_lang, target_term,
              do_not_translate, notes, created_at, updated_at`,
          [
            orgId,
            ownerUserId,
            value.sourceTerm,
            value.targetLang,
            value.targetTerm,
            value.doNotTranslate,
            value.notes,
          ]
        );
        const row = result.rows[0];
        return res.status(201).json({ ...row, tier: row.user_id ? 'personal' : 'workspace' });
      } catch (error) {
        if (error?.code === '23505') {
          return res.status(409).json({ message: 'Dieser Glossareintrag existiert bereits.' });
        }
        logApiError('Error creating translation glossary entry', error);
        return serverError(res, 'Glossareintrag konnte nicht erstellt werden');
      }
    }

    default:
      return res.status(405).json({ message: 'Method not allowed' });
  }
}

export default withOrgScope({ permission: 'org.read' }, handler);
