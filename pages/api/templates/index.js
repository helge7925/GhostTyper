import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { query } from '../../../lib/db';
import { MAX_TEMPLATE_NAME_LENGTH, MAX_TEMPLATE_PROMPT_LENGTH } from '../../../lib/constants';
import { enforceRateLimit, logApiError } from '../../../lib/api-utils';
import { validateTableSchema } from '../../../lib/table-calculations';
import { normalizeTableSchema } from '../../../lib/table-schema';

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const userId = session.user.id;
  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'templates',
    identifier: `user:${userId}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!allowed) return;

  switch (req.method) {
    case 'GET': {
      try {
        const result = await query(
          `SELECT id, user_id, name, prompt_text, template_type, table_schema, category_id, created_at, updated_at
           FROM templates
           WHERE user_id = $1
           ORDER BY name ASC`,
          [userId]
        );
        return res.status(200).json(result.rows);
      } catch (error) {
        logApiError('Error fetching templates', error);
        return res.status(500).json({ message: 'Fehler beim Laden der Vorlagen' });
      }
    }

    case 'POST': {
      const { name, prompt_text, template_type = 'text', table_schema = null, category_id = null } = req.body;
      
      if (!name || !prompt_text || typeof name !== 'string' || typeof prompt_text !== 'string') {
        return res.status(400).json({ message: 'Name und Prompt-Text sind erforderlich' });
      }
      
      const normalizedName = name.trim();
      const normalizedPrompt = prompt_text.trim();
      
      if (!normalizedName || !normalizedPrompt) {
        return res.status(400).json({ message: 'Name und Prompt-Text sind erforderlich' });
      }
      if (normalizedName.length > MAX_TEMPLATE_NAME_LENGTH) {
        return res.status(400).json({ message: `Vorlagenname ist zu lang (max. ${MAX_TEMPLATE_NAME_LENGTH} Zeichen)` });
      }
      if (normalizedPrompt.length > MAX_TEMPLATE_PROMPT_LENGTH) {
        return res.status(400).json({ message: `Prompt ist zu lang (max. ${MAX_TEMPLATE_PROMPT_LENGTH} Zeichen)` });
      }

      // Validate template_type
      if (!['text', 'table'].includes(template_type)) {
        return res.status(400).json({ message: 'Ungültiger Vorlagen-Typ' });
      }
      let tableSchemaForSave = null;
      if (template_type === 'table') {
        if (!table_schema || typeof table_schema !== 'object') {
          return res.status(400).json({ message: 'Tabellen-Schema ist erforderlich' });
        }
        const normalizedTableSchema = normalizeTableSchema(table_schema);
        const schemaValidation = validateTableSchema(normalizedTableSchema);
        if (!schemaValidation.isValid) {
          return res.status(400).json({
            message: 'Ungültiges Tabellen-Schema',
            errors: schemaValidation.errors,
          });
        }
        tableSchemaForSave = normalizedTableSchema;
      }

      try {
        const result = await query(
          `INSERT INTO templates (user_id, name, prompt_text, template_type, table_schema, category_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [userId, normalizedName, normalizedPrompt, template_type, tableSchemaForSave, category_id]
        );
        return res.status(201).json(result.rows[0]);
      } catch (error) {
        logApiError('Error creating template', error);
        return res.status(500).json({ message: 'Fehler beim Erstellen der Vorlage' });
      }
    }

    default:
      return res.status(405).json({ message: 'Method not allowed' });
  }
}
