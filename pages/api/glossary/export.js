import { query } from '../../../lib/db';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { withOrgScope } from '../../../lib/api/with-org-scope';
import { glossaryToCsv, glossaryToTbx } from '../../../lib/glossary-interop';

// Glossary export per tier (translation-excellence stage 4). Reading either
// tier is open to every member (org.read), matching pages/api/glossary/index.js
// GET. Every statement is SQL-scoped to organization_id (+ the caller for the
// personal tier).
function resolveScope(value) {
  const scope = String(Array.isArray(value) ? value[0] : value || '').trim().toLowerCase();
  return scope === 'personal' ? 'personal' : 'workspace';
}

function resolveFormat(value) {
  const format = String(Array.isArray(value) ? value[0] : value || '').trim().toLowerCase();
  return format === 'tbx' ? 'tbx' : 'csv';
}

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const userId = req.userId;
  const orgId = req.org.id;
  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'translation-glossary-export',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!allowed) return;

  const scope = resolveScope(req.query.scope);
  const format = resolveFormat(req.query.format);
  const sourceLang = String(req.query.sourceLang || 'de').trim().toLowerCase() || 'de';

  try {
    const result = scope === 'personal'
      ? await query(
        `SELECT source_term, target_lang, target_term, do_not_translate, notes
          FROM translation_glossary
          WHERE organization_id = $1 AND user_id = $2
          ORDER BY lower(source_term) ASC, target_lang ASC NULLS FIRST, id ASC`,
        [orgId, userId]
      )
      : await query(
        `SELECT source_term, target_lang, target_term, do_not_translate, notes
          FROM translation_glossary
          WHERE organization_id = $1 AND user_id IS NULL
          ORDER BY lower(source_term) ASC, target_lang ASC NULLS FIRST, id ASC`,
        [orgId]
      );

    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'tbx') {
      const xml = glossaryToTbx(result.rows, { sourceLang, scopeLabel: scope });
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="glossary-${scope}-${stamp}.tbx"`);
      return res.status(200).send(xml);
    }

    const csv = glossaryToCsv(result.rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="glossary-${scope}-${stamp}.csv"`);
    return res.status(200).send(csv);
  } catch (error) {
    logApiError('Glossary export error', error);
    return serverError(res, 'Glossar konnte nicht exportiert werden');
  }
}

export default withOrgScope({ permission: 'org.read' }, handler);
