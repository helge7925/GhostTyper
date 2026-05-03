import { query } from '../../../../lib/db';
import { enforceRateLimit, logApiError } from '../../../../lib/api-utils';
import { addTranscriptionEvent } from '../../../../lib/transcription-events';
import { ensureTranscriptionWorkerRunning, queueTranscriptionJob } from '../../../../lib/transcription-worker';
import { withOrgScope } from '../../../../lib/api/with-org-scope';

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const userId = req.userId;
  const orgId = req.org.id;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'transcription-process',
    identifier: `org:${orgId}:user:${userId}`,
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
         AND organization_id = $2
         AND status = 'pending'
       RETURNING id, user_id`,
      [transcriptionId, orgId]
    );

    if (queueResult.rowCount > 0) {
      const ownerId = queueResult.rows[0].user_id || userId;
      await addTranscriptionEvent({
        transcriptionId,
        userId: ownerId,
        organizationId: orgId,
        stage: 'queued',
        message: 'Verarbeitung eingeplant.',
      });
      queueTranscriptionJob({
        transcriptionId,
        userId: ownerId,
      });
      return res.status(202).json({ message: 'Transkription eingeplant', status: 'queued' });
    }

    const latestResult = await query(
      'SELECT status, user_id FROM transcriptions WHERE id = $1 AND organization_id = $2',
      [transcriptionId, orgId]
    );

    if (latestResult.rows.length === 0) {
      return res.status(404).json({ message: 'Transkription nicht gefunden' });
    }

    const latestStatus = latestResult.rows[0]?.status;
    const ownerId = latestResult.rows[0]?.user_id || userId;
    if (latestStatus === 'queued') {
      queueTranscriptionJob({
        transcriptionId,
        userId: ownerId,
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

export default withOrgScope({ permission: 'transcription.write' }, handler);
