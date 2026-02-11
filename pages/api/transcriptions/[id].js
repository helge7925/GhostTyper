import { unlink } from 'fs/promises';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { query } from '../../../lib/db';

export default async function handler(req, res) {
  const { id } = req.query;

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  switch (req.method) {
    case 'GET': {
      const result = await query(
        `SELECT id, original_name, filename, status, template, diarize, custom_prompt,
                text, segments, speakers, analysis, error, folder_id, is_favorite, created_at, updated_at
         FROM transcriptions
         WHERE id = $1 AND user_id = $2`,
        [id, session.user.id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ message: 'Transkription nicht gefunden' });
      }

      return res.status(200).json(result.rows[0]);
    }

    case 'PATCH': {
      const { speakers, text, documentHtml, folderId, isFavorite } = req.body;

      const existing = await query(
        'SELECT id, status FROM transcriptions WHERE id = $1 AND user_id = $2',
        [id, session.user.id]
      );

      if (existing.rows.length === 0) {
        return res.status(404).json({ message: 'Transkription nicht gefunden' });
      }

      if (speakers) {
        if (typeof speakers !== 'object') {
          return res.status(400).json({ message: 'speakers-Objekt muss ein Objekt sein' });
        }
        await query(
          'UPDATE transcriptions SET speakers = $1, updated_at = NOW() WHERE id = $2',
          [JSON.stringify(speakers), id]
        );
      }

      if (text) {
        await query(
          'UPDATE transcriptions SET text = $1, updated_at = NOW() WHERE id = $2',
          [text, id]
        );
      }

      if (documentHtml !== undefined) {
        await query(
          'UPDATE transcriptions SET document_html = $1, updated_at = NOW() WHERE id = $2',
          [documentHtml, id]
        );
      }

      if (folderId !== undefined) {
        await query(
          'UPDATE transcriptions SET folder_id = $1, updated_at = NOW() WHERE id = $2',
          [folderId, id]
        );
      }

      if (isFavorite !== undefined) {
        await query(
          'UPDATE transcriptions SET is_favorite = $1, updated_at = NOW() WHERE id = $2',
          [isFavorite, id]
        );
      }

      return res.status(200).json({ message: 'Gespeichert' });
    }

    case 'DELETE': {
      try {
        const transId = parseInt(id);
        const userId = session.user.id;

        if (isNaN(transId)) {
          return res.status(400).json({ message: 'Ungültige ID' });
        }

        const existing = await query(
          'SELECT file_path FROM transcriptions WHERE id = $1 AND user_id = $2',
          [transId, userId]
        );

        if (existing.rows.length === 0) {
          return res.status(404).json({ message: 'Eintrag nicht gefunden oder keine Berechtigung' });
        }

        const filePath = existing.rows[0].file_path;

        if (filePath && filePath !== 'INTERNAL_DOC') {
          try {
            await unlink(filePath);
          } catch (err) {
            console.warn(`File unlink failed for ${filePath}:`, err.message);
          }
        }

        await query('DELETE FROM transcriptions WHERE id = $1 AND user_id = $2', [transId, userId]);

        return res.status(200).json({ message: 'Erfolgreich gelöscht' });
      } catch (error) {
        console.error('DELETE error:', error);
        return res.status(500).json({ message: 'Fehler beim Löschen: ' + error.message });
      }
    }

    default:
      return res.status(405).json({ message: 'Method not allowed' });
  }
}
