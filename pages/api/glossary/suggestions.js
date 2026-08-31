import { query } from '../../../lib/db';
import { getSettingsRow } from '../../../lib/settings-service';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { buildGlossarySuggestions, parseContextBiasTerms } from '../../../lib/glossary';
import { withOrgScope } from '../../../lib/api/with-org-scope';
import { hasPermission } from '../../../lib/permissions';

async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const userId = req.userId;
  const orgId = req.org.id;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'glossary-suggestions',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!allowed) return;

  // Two-tier glossary: the add-to-glossary flow targets the caller's personal
  // list by default; only workspace admins may target the shared list.
  const canManageWorkspace = hasPermission(req.role, 'org.settings');

  // POST path (translation-excellence stage 3): suggest terminology from a
  // specific source text the user just translated, rather than mining recent
  // transcriptions. `exclude` carries the terms already covered by the applied
  // glossary so they are never re-suggested.
  if (req.method === 'POST') {
    try {
      const limit = Math.max(5, Math.min(100, Number.parseInt(req.body?.limit, 10) || 20));
      const text = typeof req.body?.text === 'string' ? req.body.text : '';
      const exclude = Array.isArray(req.body?.exclude)
        ? req.body.exclude.map((term) => String(term || '')).filter(Boolean)
        : [];

      const settings = await getSettingsRow(userId);
      const existingTerms = [
        ...parseContextBiasTerms(settings?.context_bias || ''),
        ...exclude,
      ];
      const suggestions = buildGlossarySuggestions({
        texts: text ? [text] : [],
        existingTerms,
        limit,
      });

      return res.status(200).json({
        suggestions,
        defaultScope: 'personal',
        canManageWorkspace,
      });
    } catch (error) {
      logApiError('Glossary suggestions (text) error', error);
      return serverError(res, 'Auto-Glossar konnte nicht geladen werden');
    }
  }

  try {
    const limit = Math.max(5, Math.min(100, Number.parseInt(req.query.limit, 10) || 30));

    const settings = await getSettingsRow(userId);
    const existingTerms = parseContextBiasTerms(settings?.context_bias || '');

    const result = await query(
      `SELECT text, custom_prompt, original_name
       FROM transcriptions
       WHERE organization_id = $1
         AND text IS NOT NULL
         AND LENGTH(text) > 0
       ORDER BY created_at DESC
       LIMIT 150`,
      [orgId]
    );

    const texts = result.rows.flatMap((row) => {
      const items = [];
      if (typeof row.text === 'string' && row.text.trim()) {
        items.push(row.text);
      }
      if (typeof row.custom_prompt === 'string' && row.custom_prompt.trim()) {
        items.push(row.custom_prompt);
      }
      if (typeof row.original_name === 'string' && row.original_name.trim()) {
        items.push(row.original_name);
      }
      return items;
    });

    const suggestions = buildGlossarySuggestions({
      texts,
      existingTerms,
      limit,
    });

    return res.status(200).json({
      existingTerms,
      suggestions,
      sourceDocuments: result.rows.length,
      defaultScope: 'personal',
      canManageWorkspace,
    });
  } catch (error) {
    logApiError('Glossary suggestions error', error);
    return serverError(res, 'Auto-Glossar konnte nicht geladen werden');
  }
}

export default withOrgScope({ permission: 'transcription.read' }, handler);
