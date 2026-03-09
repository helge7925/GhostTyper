import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { query } from '../../../lib/db';
import { getSettingsRow } from '../../../lib/settings-service';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { buildGlossarySuggestions, parseContextBiasTerms } from '../../../lib/glossary';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'glossary-suggestions',
    identifier: `user:${session.user.id}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!allowed) return;

  try {
    const limit = Math.max(5, Math.min(100, Number.parseInt(req.query.limit, 10) || 30));

    const settings = await getSettingsRow(session.user.id);
    const existingTerms = parseContextBiasTerms(settings?.context_bias || '');

    const result = await query(
      `SELECT text, custom_prompt, original_name
       FROM transcriptions
       WHERE user_id = $1
         AND text IS NOT NULL
         AND LENGTH(text) > 0
       ORDER BY created_at DESC
       LIMIT 150`,
      [session.user.id]
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
