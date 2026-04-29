import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { query } from '../../../lib/db';
import { MAX_TEMPLATE_NAME_LENGTH, MAX_TEMPLATE_PROMPT_LENGTH } from '../../../lib/constants';
import { enforceRateLimit, logApiError } from '../../../lib/api-utils';
import { validateTableSchema } from '../../../lib/table-calculations';
import { normalizeTableSchema } from '../../../lib/table-schema';
import { logAuditEvent } from '../../../lib/audit-log';

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const userId = session.user.id;
  const { id } = req.query;
  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'templates-item',
    identifier: `user:${userId}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!allowed) return;

  switch (req.method) {
    case 'PUT': {
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

      let categoryIdForSave = null;
      if (category_id !== null && category_id !== undefined && category_id !== '') {
        const parsedCategoryId = Number.parseInt(category_id, 10);
        if (!Number.isFinite(parsedCategoryId)) {
          return res.status(400).json({ message: 'Ungültige Kategorie' });
        }
        const categoryResult = await query(
          'SELECT id FROM template_categories WHERE id = $1 AND user_id = $2',
          [parsedCategoryId, userId]
        );
        if (categoryResult.rows.length === 0) {
          return res.status(400).json({ message: 'Ungültige Kategorie' });
        }
        categoryIdForSave = parsedCategoryId;
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
          `UPDATE templates
           SET name = $1, prompt_text = $2, template_type = $3, table_schema = $4, category_id = $5, updated_at = CURRENT_TIMESTAMP
           WHERE id = $6 AND user_id = $7
           RETURNING *`,
          [normalizedName, normalizedPrompt, template_type, tableSchemaForSave, categoryIdForSave, id, userId]
        );

        if (result.rowCount === 0) {
          return res.status(404).json({ message: 'Vorlage nicht gefunden' });
        }

        await logAuditEvent({
          userId,
          action: 'template.updated',
          targetType: 'template',
          targetId: String(result.rows[0].id),
          metadata: {
            templateType: template_type,
            categoryId: categoryIdForSave,
          },
        });
        return res.status(200).json(result.rows[0]);
      } catch (error) {
        logApiError('Error updating template', error);
        return res.status(500).json({ message: 'Fehler beim Aktualisieren der Vorlage' });
      }
    }

    case 'DELETE': {
      try {
        const result = await query(
          'DELETE FROM templates WHERE id = $1 AND user_id = $2',
          [id, userId]
        );

        if (result.rowCount === 0) {
          return res.status(404).json({ message: 'Vorlage nicht gefunden' });
        }

        await logAuditEvent({
          userId,
          action: 'template.deleted',
          targetType: 'template',
          targetId: String(id),
        });
        return res.status(200).json({ message: 'Vorlage gelöscht' });
      } catch (error) {
        logApiError('Error deleting template', error);
        return res.status(500).json({ message: 'Fehler beim Löschen der Vorlage' });
      }
    }

    default:
      return res.status(405).json({ message: 'Method not allowed' });
  }
}
