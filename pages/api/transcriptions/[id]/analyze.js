import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../auth/[...nextauth]';
import { query } from '../../../../lib/db';
import { resolveChatModel } from '../../../../lib/model-policy';
import { getSettingsRow, resolveStoredApiKey } from '../../../../lib/settings-service';
import { enforceRateLimit, logApiError } from '../../../../lib/api-utils';
import { addTranscriptionEvent } from '../../../../lib/transcription-events';
import { runManualAnalysisJob } from '../../../../lib/manual-analysis';
import { MAX_CUSTOM_PROMPT_LENGTH } from '../../../../lib/constants';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'transcription-analyze',
    identifier: `user:${session.user.id}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!allowed) return;

  const { id } = req.query;
  const transcriptionId = Number.parseInt(id, 10);
  const analysisFocus = typeof req.body?.analysisFocus === 'string' ? req.body.analysisFocus.trim() : '';
  if (!Number.isFinite(transcriptionId)) {
    return res.status(400).json({ message: 'Ungültige ID' });
  }
  if (analysisFocus.length > MAX_CUSTOM_PROMPT_LENGTH) {
    return res.status(400).json({ message: `Fokus der Analyse ist zu lang (max. ${MAX_CUSTOM_PROMPT_LENGTH} Zeichen)` });
  }

  const result = await query(
    'SELECT id, status, custom_prompt FROM transcriptions WHERE id = $1 AND user_id = $2',
    [transcriptionId, session.user.id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ message: 'Transkription nicht gefunden' });
  }

  const job = result.rows[0];

  if (job.status !== 'transcribed') {
    return res.status(400).json({ message: `Analyse kann nur im Status "transcribed" gestartet werden (aktuell: "${job.status}")` });
  }

  const settingsRow = await getSettingsRow(session.user.id);
  const apiKey = resolveStoredApiKey(settingsRow) || process.env.MISTRAL_API_KEY;
  const preferredModelFallback = resolveChatModel(settingsRow?.preferred_model || 'mistral-large-latest');

  if (!apiKey) {
    return res.status(400).json({ message: 'Kein Mistral API-Key konfiguriert' });
  }
  if (!preferredModelFallback) {
    return res.status(400).json({ message: 'Ungültiges Standardmodell in den Einstellungen' });
  }

  const existingPrompt = String(job.custom_prompt || '').trim();
  const mergedPrompt = [
    existingPrompt,
    analysisFocus ? `Fokus der Analyse:\n${analysisFocus}` : '',
  ].filter(Boolean).join('\n\n');
  if (mergedPrompt.length > MAX_CUSTOM_PROMPT_LENGTH) {
    return res.status(400).json({ message: `Kombinierter Analysekontext ist zu lang (max. ${MAX_CUSTOM_PROMPT_LENGTH} Zeichen)` });
  }

  // Atomically lock this job transition and prevent duplicate starts.
  const lockResult = await query(
    "UPDATE transcriptions SET status = 'analyzing', custom_prompt = $3, updated_at = NOW() WHERE id = $1 AND user_id = $2 AND status = 'transcribed' RETURNING id",
    [transcriptionId, session.user.id, mergedPrompt || null]
  );
  if (lockResult.rowCount === 0) {
    return res.status(409).json({ message: 'Analyse wurde bereits gestartet oder hat den Status geändert.' });
  }

  res.status(202).json({ message: 'Analyse gestartet', status: 'analyzing' });
  await addTranscriptionEvent({
    transcriptionId,
    userId: session.user.id,
    stage: 'analyzing',
    message: 'Manuelle KI-Analyse gestartet.',
  });

  queueMicrotask(() => {
    runManualAnalysisJob({
      transcriptionId,
      userId: session.user.id,
    }).catch((error) => {
      logApiError(`Manual analysis enqueue ${transcriptionId} failed`, error, {
        userId: session.user.id,
      });
    });
  });
}
