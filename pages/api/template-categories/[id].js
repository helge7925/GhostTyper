import { query } from '../../../lib/db';
import { enforceRateLimit, logApiError } from '../../../lib/api-utils';
import { withOrgScope } from '../../../lib/api/with-org-scope';
import { hasPermission } from '../../../lib/permissions';

async function handler(req, res) {
  const userId = req.userId;
  const orgId = req.org.id;
  const { id } = req.query;
  const categoryId = parseInt(id, 10);

  if (!Number.isFinite(categoryId)) {
    return res.status(400).json({ message: 'Ungültige Kategorie-ID' });
  }

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'template-category',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!allowed) return;

  const ownerCheck = await query(
    'SELECT id FROM template_categories WHERE id = $1 AND organization_id = $2',
    [categoryId, orgId]
  );
  if (ownerCheck.rows.length === 0) {
    return res.status(404).json({ message: 'Kategorie nicht gefunden' });
  }

  switch (req.method) {
    case 'PUT': {
      if (!hasPermission(req.role, 'template.write')) {
        return res.status(403).json({ code: 'FORBIDDEN', message: 'Keine Berechtigung zum Bearbeiten von Kategorien.' });
      }
      const { name, color, position } = req.body;

      try {
        const updates = [];
        const values = [];
        let paramIndex = 1;

        if (name !== undefined) {
          const normalizedName = (typeof name === 'string' ? name : '').trim();
          if (!normalizedName) {
            return res.status(400).json({ message: 'Name darf nicht leer sein' });
          }
          if (normalizedName.length > 100) {
            return res.status(400).json({ message: 'Name ist zu lang (max. 100 Zeichen)' });
          }
          updates.push(`name = $${paramIndex++}`);
          values.push(normalizedName);
        }

        if (color !== undefined) {
          updates.push(`color = $${paramIndex++}`);
          values.push(color);
        }

        if (position !== undefined) {
          updates.push(`position = $${paramIndex++}`);
          values.push(parseInt(position, 10) || 0);
        }

        if (updates.length === 0) {
          return res.status(400).json({ message: 'Keine Änderungen angegeben' });
        }

        updates.push(`updated_at = NOW()`);
        values.push(categoryId, orgId);

        const result = await query(
          `UPDATE template_categories SET ${updates.join(', ')}
           WHERE id = $${paramIndex++} AND organization_id = $${paramIndex}
           RETURNING *`,
          values
        );
        return res.status(200).json(result.rows[0]);
      } catch (error) {
        logApiError('Error updating template category', error);
        return res.status(500).json({ message: 'Fehler beim Aktualisieren der Kategorie' });
      }
    }

    case 'DELETE': {
      if (!hasPermission(req.role, 'template.delete')) {
        return res.status(403).json({ code: 'FORBIDDEN', message: 'Keine Berechtigung zum Löschen von Kategorien.' });
      }
      try {
        await query('DELETE FROM template_categories WHERE id = $1 AND organization_id = $2', [categoryId, orgId]);
        return res.status(200).json({ success: true });
      } catch (error) {
        logApiError('Error deleting template category', error);
        return res.status(500).json({ message: 'Fehler beim Löschen der Kategorie' });
      }
    }

    default:
      return res.status(405).json({ message: 'Method not allowed' });
  }
}

export default withOrgScope({ permission: 'template.read' }, handler);
