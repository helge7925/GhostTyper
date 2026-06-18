import { query } from './db';
import { logError } from './observability';

export async function resolveTemplate(templateId, userId) {
  try {
    let queryText = `
      SELECT id, name, prompt_text, template_type, table_schema
      FROM templates
      WHERE (id::text = $1 OR name = $1) AND user_id = $2
    `;
    let cleanId = templateId;

    if (templateId?.startsWith('custom-')) {
      cleanId = templateId.replace('custom-', '');
      queryText = `
        SELECT id, name, prompt_text, template_type, table_schema
        FROM templates
        WHERE id::text = $1 AND user_id = $2
      `;
    }

    const result = await query(queryText, [cleanId, userId]);
    if (result.rows.length > 0) {
      return result.rows[0];
    }
  } catch (error) {
    logError('template.resolve_failed', error, { userId, templateId });
  }

  // Built-ins. `aufmass` is kept here so legacy DB rows still resolve;
  // it is no longer offered in the UI (see components/AudioUploadForm.js,
  // pages/ocr.js, pages/settings.js).
  if (['meeting', 'generic', 'action_items', 'data_table', 'aufmass'].includes(templateId)) {
    return {
      id: null,
      name: templateId,
      prompt_text: templateId,
      template_type: 'text',
      table_schema: null,
    };
  }

  return {
    id: null,
    name: 'generic',
    prompt_text: 'generic',
    template_type: 'text',
    table_schema: null,
  };
}
