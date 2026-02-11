import path from 'path';
import { unlink } from 'fs/promises';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { query } from '../../../lib/db';
import { checkRateLimit, applyRateLimitHeaders } from '../../../lib/rate-limit';
import { logApiError, serverError } from '../../../lib/api-utils';
import { addTranscriptionEvent, listTranscriptionEvents } from '../../../lib/transcription-events';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

function isSafeUploadPath(filePath) {
  if (!filePath) return false;
  const resolved = path.resolve(filePath);
  return resolved.startsWith(path.resolve(UPLOADS_DIR) + path.sep);
}

export default async function handler(req, res) {
  const { id } = req.query;
  const transId = parseInt(id, 10);

  if (Number.isNaN(transId)) {
    return res.status(400).json({ message: 'Ungültige ID' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const rate = checkRateLimit(req, {
    keyPrefix: 'transcriptions-item',
    identifier: `user:${session.user.id}`,
    limit: 120,
    windowMs: 60_000,
  });
  applyRateLimitHeaders(res, rate);
  if (!rate.allowed) {
    return res.status(429).json({ message: 'Zu viele Anfragen. Bitte später erneut versuchen.' });
  }

  switch (req.method) {
    case 'GET': {
      try {
        const result = await query(
          `SELECT id, original_name, filename, status, template, diarize, auto_analyze, custom_prompt,
                  mime_type, model,
                  text, segments, speakers, analysis, error, folder_id, is_favorite, created_at, updated_at
           FROM transcriptions
           WHERE id = $1 AND user_id = $2`,
          [transId, session.user.id]
        );

        if (result.rows.length === 0) {
          return res.status(404).json({ message: 'Transkription nicht gefunden' });
        }

        const transcription = result.rows[0];
        const staleStatuses = new Set(['processing', 'analyzing']);
        const updatedAt = new Date(transcription.updated_at).getTime();
        if (
          staleStatuses.has(transcription.status) &&
          Number.isFinite(updatedAt) &&
          Date.now() - updatedAt > 45 * 60 * 1000
        ) {
          await query(
            `UPDATE transcriptions
             SET status = 'error',
                 error = 'Verarbeitung wurde unterbrochen. Bitte erneut starten.',
                 updated_at = NOW()
             WHERE id = $1 AND user_id = $2`,
            [transId, session.user.id]
          );
          transcription.status = 'error';
          transcription.error = 'Verarbeitung wurde unterbrochen. Bitte erneut starten.';
          await addTranscriptionEvent({
            transcriptionId: transId,
            userId: session.user.id,
            stage: 'error',
            message: 'Verarbeitung wurde wegen Zeitüberschreitung als fehlerhaft markiert.',
          });
        }

        transcription.events = await listTranscriptionEvents(transId, session.user.id);
        return res.status(200).json(transcription);
      } catch (error) {
        logApiError('Transcription GET error', error);
        return serverError(res, 'Fehler beim Laden der Transkription');
      }
    }

    case 'PATCH': {
      const { speakers, text, documentHtml, folderId, isFavorite } = req.body;

      try {
        const existing = await query(
          'SELECT id FROM transcriptions WHERE id = $1 AND user_id = $2',
          [transId, session.user.id]
        );

        if (existing.rows.length === 0) {
          return res.status(404).json({ message: 'Transkription nicht gefunden' });
        }

        const updates = [];
        const values = [];
        let paramIndex = 1;

        if (speakers !== undefined) {
          if (typeof speakers !== 'object' || speakers === null || Array.isArray(speakers)) {
            return res.status(400).json({ message: 'speakers-Objekt muss ein Objekt sein' });
          }
          updates.push(`speakers = $${paramIndex++}`);
          values.push(JSON.stringify(speakers));
        }

        if (text !== undefined) {
          updates.push(`text = $${paramIndex++}`);
          values.push(text);
        }

        if (documentHtml !== undefined) {
          updates.push(`document_html = $${paramIndex++}`);
          values.push(documentHtml);
        }

        if (folderId !== undefined) {
          if (folderId === null) {
            updates.push(`folder_id = $${paramIndex++}`);
            values.push(null);
          } else {
            const folder = await query(
              'SELECT id FROM folders WHERE id = $1 AND user_id = $2',
              [folderId, session.user.id]
            );
            if (folder.rows.length === 0) {
              return res.status(400).json({ message: 'Ungültiger Ordner' });
            }
            updates.push(`folder_id = $${paramIndex++}`);
            values.push(folderId);
          }
        }

        if (isFavorite !== undefined) {
          updates.push(`is_favorite = $${paramIndex++}`);
          values.push(Boolean(isFavorite));
        }

        if (updates.length === 0) {
          return res.status(200).json({ message: 'Keine Änderungen' });
        }

        updates.push('updated_at = NOW()');
        values.push(transId, session.user.id);

        await query(
          `UPDATE transcriptions SET ${updates.join(', ')} WHERE id = $${paramIndex++} AND user_id = $${paramIndex}`,
          values
        );

        return res.status(200).json({ message: 'Gespeichert' });
      } catch (error) {
        logApiError('Transcription PATCH error', error);
        return serverError(res, 'Fehler beim Speichern');
      }
    }

    case 'DELETE': {
      try {
        const existing = await query(
          'SELECT file_path FROM transcriptions WHERE id = $1 AND user_id = $2',
          [transId, session.user.id]
        );

        if (existing.rows.length === 0) {
          return res.status(404).json({ message: 'Eintrag nicht gefunden oder keine Berechtigung' });
        }

        const filePath = existing.rows[0].file_path;
        if (filePath && filePath !== 'INTERNAL_DOC' && isSafeUploadPath(filePath)) {
          await unlink(filePath).catch(() => {});
        }

        await query('DELETE FROM transcriptions WHERE id = $1 AND user_id = $2', [transId, session.user.id]);
        return res.status(200).json({ message: 'Erfolgreich gelöscht' });
      } catch (error) {
        logApiError('Transcription DELETE error', error);
        return serverError(res, 'Fehler beim Löschen');
      }
    }

    default:
      return res.status(405).json({ message: 'Method not allowed' });
  }
}
