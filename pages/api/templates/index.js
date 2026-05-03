import { query } from '../../../lib/db';
import { MAX_TEMPLATE_NAME_LENGTH, MAX_TEMPLATE_PROMPT_LENGTH } from '../../../lib/constants';
import { enforceRateLimit, logApiError } from '../../../lib/api-utils';
import { validateTableSchema } from '../../../lib/table-calculations';
import { normalizeTableSchema } from '../../../lib/table-schema';
import { logAuditEvent } from '../../../lib/audit-log';
import { withOrgScope } from '../../../lib/api/with-org-scope';
import { hasPermission } from '../../../lib/permissions';

async function handler(req, res) {
  const userId = req.userId;
  const orgId = req.org.id;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'templates',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!allowed) return;

  switch (req.method) {
    case 'GET': {
      try {
        const result = await query(
          `SELECT id, user_id, organization_id, name, prompt_text, template_type, table_schema, category_id, created_at, updated_at
           FROM templates
           WHERE organization_id = $1
           ORDER BY name ASC`,
          [orgId]
        );
        return res.status(200).json(result.rows);
      } catch (error) {
        logApiError('Error fetching templates', error);
        return res.status(500).json({ message: 'Fehler beim Laden der Vorlagen' });
      }
    }

    case 'POST': {
      if (!hasPermission(req.role, 'template.write')) {
        return res.status(403).json({ code: 'FORBIDDEN', message: 'Keine Berechtigung zum Anlegen von Vorlagen.' });
      }
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
          'SELECT id FROM template_categories WHERE id = $1 AND organization_id = $2',
          [parsedCategoryId, orgId]
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
          `INSERT INTO templates (user_id, organization_id, name, prompt_text, template_type, table_schema, category_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [userId, orgId, normalizedName, normalizedPrompt, template_type, tableSchemaForSave, categoryIdForSave]
        );
        await logAuditEvent({
          userId,
          organizationId: orgId,
          action: 'template.created',
          targetType: 'template',
          targetId: String(result.rows[0].id),
          metadata: {
            templateType: template_type,
            categoryId: categoryIdForSave,
          },
        });
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

export default withOrgScope({ permission: 'template.read' }, handler);
