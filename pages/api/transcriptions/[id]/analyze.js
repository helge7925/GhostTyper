import { query } from '../../../../lib/db';
import { resolveChatModel } from '../../../../lib/model-policy';
import { getSettingsRow, resolveCortecsConfig } from '../../../../lib/settings-service';
import { enforceRateLimit, logApiError } from '../../../../lib/api-utils';
import { addTranscriptionEvent } from '../../../../lib/transcription-events';
import { runManualAnalysisJob } from '../../../../lib/manual-analysis';
import { MAX_CUSTOM_PROMPT_LENGTH } from '../../../../lib/constants';
import { withOrgScope } from '../../../../lib/api/with-org-scope';

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const userId = req.userId;
  const orgId = req.org.id;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'transcription-analyze',
    identifier: `org:${orgId}:user:${userId}`,
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
    'SELECT id, status, custom_prompt FROM transcriptions WHERE id = $1 AND organization_id = $2',
    [transcriptionId, orgId]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ message: 'Transkription nicht gefunden' });
  }

  const job = result.rows[0];

  if (job.status !== 'transcribed') {
    return res.status(400).json({ message: `Analyse kann nur im Status "transcribed" gestartet werden (aktuell: "${job.status}")` });
  }

  const settingsRow = await getSettingsRow(userId);
  const cortecs = await resolveCortecsConfig({ userId, organizationId: req.org?.id });
  const apiKey = cortecs.apiKey;
  const preferredModelFallback = resolveChatModel(cortecs.chatModel || settingsRow?.preferred_model) || cortecs.chatModel;

  if (!apiKey) {
    return res.status(400).json({ message: 'Kein Cortecs API-Key konfiguriert' });
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
    "UPDATE transcriptions SET status = 'analyzing', custom_prompt = $3, updated_at = NOW() WHERE id = $1 AND organization_id = $2 AND status = 'transcribed' RETURNING id",
    [transcriptionId, orgId, mergedPrompt || null]
  );
  if (lockResult.rowCount === 0) {
    return res.status(409).json({ message: 'Analyse wurde bereits gestartet oder hat den Status geändert.' });
  }

  res.status(202).json({ message: 'Analyse gestartet', status: 'analyzing' });
  await addTranscriptionEvent({
    transcriptionId,
    userId,
    organizationId: orgId,
    stage: 'analyzing',
    message: 'Manuelle KI-Analyse gestartet.',
  });

  queueMicrotask(() => {
    runManualAnalysisJob({
      transcriptionId,
      userId,
      organizationId: orgId,
    }).catch((error) => {
      logApiError(`Manual analysis enqueue ${transcriptionId} failed`, error, {
        userId,
      });
    });
  });
}

export default withOrgScope({ permission: 'transcription.write' }, handler);
