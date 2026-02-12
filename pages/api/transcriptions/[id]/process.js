import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../auth/[...nextauth]';
import { query } from '../../../../lib/db';
import { enforceRateLimit, logApiError } from '../../../../lib/api-utils';
import { addTranscriptionEvent } from '../../../../lib/transcription-events';
import { ensureTranscriptionWorkerRunning, queueTranscriptionJob } from '../../../../lib/transcription-worker';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'transcription-process',
    identifier: `user:${session.user.id}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!allowed) return;

  const transcriptionId = Number.parseInt(req.query.id, 10);
  if (!Number.isFinite(transcriptionId)) {
    return res.status(400).json({ message: 'Ungültige ID' });
  }

  try {
    ensureTranscriptionWorkerRunning();

    const queueResult = await query(
      `UPDATE transcriptions
       SET status = 'queued',
           error = NULL,
           updated_at = NOW()
       WHERE id = $1
         AND user_id = $2
         AND status = 'pending'
       RETURNING id`,
      [transcriptionId, session.user.id]
    );

    if (queueResult.rowCount > 0) {
      await addTranscriptionEvent({
        transcriptionId,
        userId: session.user.id,
        stage: 'queued',
        message: 'Verarbeitung eingeplant.',
      });
      queueTranscriptionJob({
        transcriptionId,
        userId: session.user.id,
      });
      return res.status(202).json({ message: 'Transkription eingeplant', status: 'queued' });
    }

    const latestResult = await query(
      'SELECT status FROM transcriptions WHERE id = $1 AND user_id = $2',
      [transcriptionId, session.user.id]
    );

    if (latestResult.rows.length === 0) {
      return res.status(404).json({ message: 'Transkription nicht gefunden' });
    }

    const latestStatus = latestResult.rows[0]?.status;
    if (latestStatus === 'queued') {
      queueTranscriptionJob({
        transcriptionId,
        userId: session.user.id,
      });
      return res.status(202).json({ message: 'Transkription bereits eingeplant.', status: 'queued' });
    }
    if (latestStatus === 'processing' || latestStatus === 'analyzing') {
      return res.status(202).json({ message: 'Verarbeitung läuft bereits.', status: latestStatus });
    }
    if (latestStatus === 'transcribed' || latestStatus === 'completed') {
      return res.status(200).json({ message: 'Verarbeitung ist bereits abgeschlossen.', status: latestStatus });
    }
    return res.status(400).json({ message: `Transkription hat Status "${latestStatus}" und kann nicht erneut gestartet werden` });
  } catch (error) {
    logApiError(`Transcription ${transcriptionId} queue failed`, error);
    if (error?.code === '42703') {
      return res.status(500).json({ message: 'Datenbank-Schema ist veraltet. Bitte DB-Init ausführen.' });
    }
    return res.status(500).json({ message: 'Verarbeitung konnte nicht gestartet werden.' });
  }
}
