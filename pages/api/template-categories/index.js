import { query } from '../../../lib/db';
import { enforceRateLimit, logApiError } from '../../../lib/api-utils';
import { withOrgScope } from '../../../lib/api/with-org-scope';
import { hasPermission } from '../../../lib/permissions';

async function handler(req, res) {
  const userId = req.userId;
  const orgId = req.org.id;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'template-categories',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!allowed) return;

  switch (req.method) {
    case 'GET': {
      try {
        const result = await query(
          `SELECT id, user_id, organization_id, name, color, position, created_at, updated_at
           FROM template_categories
           WHERE organization_id = $1
           ORDER BY position ASC, name ASC`,
          [orgId]
        );
        return res.status(200).json(result.rows);
      } catch (error) {
        logApiError('Error fetching template categories', error);
        return res.status(500).json({ message: 'Fehler beim Laden der Kategorien' });
      }
    }

    case 'POST': {
      if (!hasPermission(req.role, 'template.write')) {
        return res.status(403).json({ code: 'FORBIDDEN', message: 'Keine Berechtigung zum Anlegen von Kategorien.' });
      }
      const { name, color = '#f97316' } = req.body;

      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ message: 'Name ist erforderlich' });
      }

      const normalizedName = name.trim();
      if (normalizedName.length > 100) {
        return res.status(400).json({ message: 'Name ist zu lang (max. 100 Zeichen)' });
      }

      try {
        const maxPosResult = await query(
          'SELECT COALESCE(MAX(position), -1) as max_pos FROM template_categories WHERE organization_id = $1',
          [orgId]
        );
        const nextPosition = (maxPosResult.rows[0].max_pos || -1) + 1;

        const result = await query(
          `INSERT INTO template_categories (user_id, organization_id, name, color, position)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [userId, orgId, normalizedName, color, nextPosition]
        );
        return res.status(201).json(result.rows[0]);
      } catch (error) {
        logApiError('Error creating template category', error);
        return res.status(500).json({ message: 'Fehler beim Erstellen der Kategorie' });
      }
    }

    default:
      return res.status(405).json({ message: 'Method not allowed' });
  }
}

export default withOrgScope({ permission: 'template.read' }, handler);
