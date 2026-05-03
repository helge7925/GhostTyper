import { query } from '../../../lib/db';
import { MAX_FOLDER_NAME_LENGTH } from '../../../lib/constants';
import { enforceRateLimit, logApiError } from '../../../lib/api-utils';
import { withOrgScope } from '../../../lib/api/with-org-scope';
import { hasPermission } from '../../../lib/permissions';

async function handler(req, res) {
  const userId = req.userId;
  const orgId = req.org.id;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'folders',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!allowed) return;

  switch (req.method) {
    case 'GET': {
      try {
        const result = await query(
          'SELECT * FROM folders WHERE organization_id = $1 ORDER BY name ASC',
          [orgId]
        );
        return res.status(200).json(result.rows);
      } catch (error) {
        logApiError('Error fetching folders', error);
        return res.status(500).json({ message: 'Fehler beim Laden der Ordner' });
      }
    }

    case 'POST': {
      if (!hasPermission(req.role, 'folder.write')) {
        return res.status(403).json({ code: 'FORBIDDEN', message: 'Keine Berechtigung zum Anlegen von Ordnern.' });
      }
      const { name } = req.body;
      if (!name || typeof name !== 'string') {
        return res.status(400).json({ message: 'Ordnername ist erforderlich' });
      }
      const normalizedName = name.trim();
      if (!normalizedName) {
        return res.status(400).json({ message: 'Ordnername ist erforderlich' });
      }
      if (normalizedName.length > MAX_FOLDER_NAME_LENGTH) {
        return res.status(400).json({ message: `Ordnername ist zu lang (max. ${MAX_FOLDER_NAME_LENGTH} Zeichen)` });
      }

      try {
        const result = await query(
          'INSERT INTO folders (user_id, organization_id, name) VALUES ($1, $2, $3) RETURNING *',
          [userId, orgId, normalizedName]
        );
        return res.status(201).json(result.rows[0]);
      } catch (error) {
        logApiError('Error creating folder', error);
        return res.status(500).json({ message: 'Fehler beim Erstellen des Ordners' });
      }
    }

    default:
      return res.status(405).json({ message: 'Method not allowed' });
  }
}

export default withOrgScope({ permission: 'folder.read' }, handler);
