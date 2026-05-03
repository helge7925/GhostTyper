import { query } from '../../../lib/db';
import { getSettingsRow } from '../../../lib/settings-service';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { buildGlossarySuggestions, parseContextBiasTerms } from '../../../lib/glossary';
import { withOrgScope } from '../../../lib/api/with-org-scope';

async function handler(req, res) {
  if (req.method !== 'GET') {
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
    });
  } catch (error) {
    logApiError('Glossary suggestions error', error);
    return serverError(res, 'Auto-Glossar konnte nicht geladen werden');
  }
}

export default withOrgScope({ permission: 'transcription.read' }, handler);
