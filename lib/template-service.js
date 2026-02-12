import { query } from './db';
import { logError } from './observability';

export async function resolveTemplate(templateId, userId) {
  try {
    let queryText = 'SELECT prompt_text FROM templates WHERE (id::text = $1 OR name = $1) AND user_id = $2';
    let cleanId = templateId;

    if (templateId?.startsWith('custom-')) {
      cleanId = templateId.replace('custom-', '');
      queryText = 'SELECT prompt_text FROM templates WHERE id::text = $1 AND user_id = $2';
    }

    const result = await query(queryText, [cleanId, userId]);
    if (result.rows.length > 0) {
      return result.rows[0].prompt_text;
    }
  } catch (error) {
    logError('template.resolve_failed', error, { userId, templateId });
  }

  if (['meeting', 'aufmass', 'generic'].includes(templateId)) {
    return templateId;
  }

  return 'generic';
}
