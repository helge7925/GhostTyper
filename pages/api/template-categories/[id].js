import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { query } from '../../../lib/db';
import { enforceRateLimit, logApiError } from '../../../lib/api-utils';

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const userId = session.user.id;
  const { id } = req.query;
  const categoryId = parseInt(id, 10);

  if (!Number.isFinite(categoryId)) {
    return res.status(400).json({ message: 'Ungültige Kategorie-ID' });
  }

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'template-category',
    identifier: `user:${userId}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!allowed) return;

  const ownerCheck = await query(
    'SELECT id FROM template_categories WHERE id = $1 AND user_id = $2',
    [categoryId, userId]
  );
  if (ownerCheck.rows.length === 0) {
    return res.status(404).json({ message: 'Kategorie nicht gefunden' });
  }

  switch (req.method) {
    case 'PUT': {
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
        values.push(categoryId, userId);

        const result = await query(
          `UPDATE template_categories SET ${updates.join(', ')}
           WHERE id = $${paramIndex++} AND user_id = $${paramIndex}
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
      try {
        await query('DELETE FROM template_categories WHERE id = $1 AND user_id = $2', [categoryId, userId]);
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
