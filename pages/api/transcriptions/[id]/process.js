import { query } from '../../../../lib/db';
import { enforceRateLimit, logApiError } from '../../../../lib/api-utils';
import { addTranscriptionEvent } from '../../../../lib/transcription-events';
import { ensureTranscriptionWorkerRunning, queueTranscriptionJob } from '../../../../lib/transcription-worker';
import { runManualAnalysisJob } from '../../../../lib/manual-analysis';
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
    // Inspect the row first so we can route Vexa-meeting rows away from the
    // audio worker (which expects a file_path and crashes with `path.extname(null)`
    // on rows that came from the meeting bot).
    const head = await query(
      `SELECT id, source, status, text, user_id, file_path
         FROM transcriptions
        WHERE id = $1 AND organization_id = $2`,
      [transcriptionId, orgId]
    );

    if (head.rows.length === 0) {
      return res.status(404).json({ message: 'Transkription nicht gefunden' });
    }

    const row = head.rows[0];
    const ownerId = row.user_id || userId;
    const isVexaRow = row.source === 'vexa';
    const hasText = typeof row.text === 'string' && row.text.trim().length > 0;

    // ── Vexa branch ────────────────────────────────────────────────
    // For meeting rows we never go through the audio worker. If the bridge
    // already captured text we kick straight into the manual-analysis job;
    // otherwise we tell the user to wait / re-trigger after the bot is done.
    if (isVexaRow) {
      if (!hasText) {
        return res.status(400).json({
          message:
            row.status === 'pending' || row.status === 'processing'
              ? 'Bot ist noch aktiv. Bitte warte, bis das Meeting beendet wurde.'
              : 'Kein Transkript vorhanden – Verarbeitung kann nicht gestartet werden.',
        });
      }

      if (row.status === 'analyzing') {
        return res.status(202).json({ message: 'Analyse läuft bereits.', status: 'analyzing' });
      }
      if (row.status === 'completed') {
        return res.status(200).json({ message: 'Analyse ist bereits abgeschlossen.', status: 'completed' });
      }

      // Atomically transition pending/processing/transcribed/error → analyzing.
      const lock = await query(
        `UPDATE transcriptions
            SET status = 'analyzing',
                error = NULL,
                updated_at = NOW()
          WHERE id = $1
            AND organization_id = $2
            AND status IN ('pending','processing','transcribed','error')
          RETURNING id`,
        [transcriptionId, orgId]
      );

      if (lock.rowCount === 0) {
        const latest = await query(
          'SELECT status FROM transcriptions WHERE id = $1 AND organization_id = $2',
          [transcriptionId, orgId]
        );
        const status = latest.rows[0]?.status;
        return res.status(409).json({
          message: `Analyse kann im Status "${status}" nicht gestartet werden.`,
          status,
        });
      }

      await addTranscriptionEvent({
        transcriptionId,
        userId: ownerId,
        organizationId: orgId,
        stage: 'analyzing',
        message: 'Analyse für Remote-Meeting manuell gestartet.',
      });

      queueMicrotask(() => {
        runManualAnalysisJob({
          transcriptionId,
          userId: ownerId,
          organizationId: orgId,
        }).catch((error) => {
          logApiError(`Manual analysis (vexa-process) ${transcriptionId} failed`, error, {
            userId: ownerId,
          });
        });
      });

      return res.status(202).json({ message: 'Analyse gestartet.', status: 'analyzing' });
    }

    // ── File-upload branch (unchanged) ─────────────────────────────
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
      const queueOwner = queueResult.rows[0].user_id || userId;
      await addTranscriptionEvent({
        transcriptionId,
        userId: queueOwner,
        organizationId: orgId,
        stage: 'queued',
        message: 'Verarbeitung eingeplant.',
      });
      queueTranscriptionJob({
        transcriptionId,
        userId: queueOwner,
      });
      return res.status(202).json({ message: 'Transkription eingeplant', status: 'queued' });
    }

    if (row.status === 'queued') {
      queueTranscriptionJob({
        transcriptionId,
        userId: ownerId,
      });
      return res.status(202).json({ message: 'Transkription bereits eingeplant.', status: 'queued' });
    }
    if (row.status === 'processing' || row.status === 'analyzing') {
      return res.status(202).json({ message: 'Verarbeitung läuft bereits.', status: row.status });
    }
    if (row.status === 'transcribed' || row.status === 'completed') {
      return res.status(200).json({ message: 'Verarbeitung ist bereits abgeschlossen.', status: row.status });
    }
    return res.status(400).json({ message: `Transkription hat Status "${row.status}" und kann nicht erneut gestartet werden` });
  } catch (error) {
    logApiError(`Transcription ${transcriptionId} queue failed`, error);
    if (error?.code === '42703') {
      return res.status(500).json({ message: 'Datenbank-Schema ist veraltet. Bitte DB-Init ausführen.' });
    }
    return res.status(500).json({ message: 'Verarbeitung konnte nicht gestartet werden.' });
  }
}

export default withOrgScope({ permission: 'transcription.write' }, handler);
