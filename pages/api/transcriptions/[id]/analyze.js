import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../auth/[...nextauth]';
import { query } from '../../../../lib/db';
import { analyzeTranscription, buildTextWithSpeakers } from '../../../../lib/ai-service';
import { logUsage, checkCostLimit } from '../../../../lib/usage';
import { resolveChatModel } from '../../../../lib/model-policy';
import { getSettingsRow, resolveStoredApiKey } from '../../../../lib/settings-service';
import { checkRateLimit, applyRateLimitHeaders } from '../../../../lib/rate-limit';
import { logApiError } from '../../../../lib/api-utils';
import { addTranscriptionEvent } from '../../../../lib/transcription-events';
import { resolveTemplate } from '../../../../lib/template-service';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const rate = checkRateLimit(req, {
    keyPrefix: 'transcription-analyze',
    identifier: `user:${session.user.id}`,
    limit: 30,
    windowMs: 60_000,
  });
  applyRateLimitHeaders(res, rate);
  if (!rate.allowed) {
    return res.status(429).json({ message: 'Zu viele Anfragen. Bitte später erneut versuchen.' });
  }

  const { id } = req.query;

  const result = await query(
    'SELECT id, text, segments, speakers, template, model, custom_prompt, status FROM transcriptions WHERE id = $1 AND user_id = $2',
    [id, session.user.id]
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
  const language = settingsRow?.language || 'de';

  if (!apiKey) {
    return res.status(400).json({ message: 'Kein Mistral API-Key konfiguriert' });
  }
  if (!preferredModelFallback) {
    return res.status(400).json({ message: 'Ungültiges Standardmodell in den Einstellungen' });
  }

  // Check cost limit
  const costCheck = await checkCostLimit(session.user.id);
  if (!costCheck.allowed) {
    return res.status(429).json({
      message: `Monatliches Kostenlimit erreicht (${costCheck.currentCost.toFixed(2)} / ${costCheck.limit.toFixed(2)} €)`,
    });
  }

  // Atomically lock this job transition and prevent duplicate starts.
  const lockResult = await query(
    "UPDATE transcriptions SET status = 'analyzing', updated_at = NOW() WHERE id = $1 AND user_id = $2 AND status = 'transcribed' RETURNING id",
    [id, session.user.id]
  );
  if (lockResult.rowCount === 0) {
    return res.status(409).json({ message: 'Analyse wurde bereits gestartet oder hat den Status geändert.' });
  }

  res.status(202).json({ message: 'Analyse gestartet', status: 'analyzing' });
  await addTranscriptionEvent({
    transcriptionId: Number(id),
    userId: session.user.id,
    stage: 'analyzing',
    message: 'Manuelle KI-Analyse gestartet.',
  });

  // Build text with speaker names if available
  try {
    let analysisText = job.text;
    const speakers = job.speakers || {};
    const segments = job.segments || [];

    if (segments.length > 0 && Object.keys(speakers).length > 0) {
      analysisText = buildTextWithSpeakers(segments, speakers);
    }

    // Update text with speaker names applied
    if (analysisText !== job.text) {
      await query(
        'UPDATE transcriptions SET text = $1, updated_at = NOW() WHERE id = $2',
        [analysisText, id]
      );
      await addTranscriptionEvent({
        transcriptionId: Number(id),
        userId: session.user.id,
        stage: 'analyzing',
        message: 'Sprechernamen in den Text übernommen.',
      });
    }

    const resolvedTemplate = await resolveTemplate(job.template, session.user.id);
    const { analysis, usage: analysisUsage, model: analysisModel } = await analyzeTranscription(
      analysisText, 
      resolvedTemplate, 
      apiKey, 
      job.custom_prompt || '', 
      resolveChatModel(job.model || preferredModelFallback) || preferredModelFallback,
      language
    );

    // Log analysis usage
    await logUsage(session.user.id, analysisModel, 'analysis', analysisUsage);

    await query(
      "UPDATE transcriptions SET status = 'completed', analysis = $1, updated_at = NOW() WHERE id = $2",
      [JSON.stringify(analysis), id]
    );
    await addTranscriptionEvent({
      transcriptionId: Number(id),
      userId: session.user.id,
      stage: 'completed',
      message: 'Manuelle KI-Analyse abgeschlossen.',
    });
  } catch (error) {
    logApiError(`Analysis ${id} failed`, error);
    await query(
      "UPDATE transcriptions SET status = 'error', error = $1, updated_at = NOW() WHERE id = $2",
      ['Analyse fehlgeschlagen. Bitte erneut versuchen.', id]
    );
    await addTranscriptionEvent({
      transcriptionId: Number(id),
      userId: session.user.id,
      stage: 'error',
      message: 'Fehler während der manuellen KI-Analyse.',
    });
  }
}
