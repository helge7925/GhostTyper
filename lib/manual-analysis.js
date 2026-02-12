import { analyzeTranscription, buildTextWithSpeakers } from './ai-service';
import { logApiError } from './api-utils';
import { query } from './db';
import { resolveChatModel } from './model-policy';
import { getSettingsRow, resolveStoredApiKey } from './settings-service';
import { addTranscriptionEvent } from './transcription-events';
import { resolveTemplate } from './template-service';
import { CostLimitExceededError, checkCostLimit, logUsage, withUserCostLock } from './usage';

async function markManualAnalysisError(transcriptionId, userId, message, eventMessage) {
  await query(
    "UPDATE transcriptions SET status = 'error', error = $1, updated_at = NOW() WHERE id = $2",
    [message, transcriptionId]
  );
  await addTranscriptionEvent({
    transcriptionId,
    userId,
    stage: 'error',
    message: eventMessage || message,
  });
}

export async function runManualAnalysisJob({ transcriptionId, userId }) {
  const result = await query(
    'SELECT id, text, segments, speakers, template, model, custom_prompt, status FROM transcriptions WHERE id = $1 AND user_id = $2',
    [transcriptionId, userId]
  );
  const job = result.rows[0];
  if (!job || job.status !== 'analyzing') return;

  const settingsRow = await getSettingsRow(userId);
  const apiKey = resolveStoredApiKey(settingsRow) || process.env.MISTRAL_API_KEY;
  const preferredModelFallback = resolveChatModel(settingsRow?.preferred_model || 'mistral-large-latest');
  const language = settingsRow?.language || 'de';

  if (!apiKey) {
    await markManualAnalysisError(
      transcriptionId,
      userId,
      'Kein Mistral API-Key konfiguriert',
      'Analyse ohne API-Key nicht möglich.'
    );
    return;
  }
  if (!preferredModelFallback) {
    await markManualAnalysisError(
      transcriptionId,
      userId,
      'Ungültiges Standardmodell in den Einstellungen',
      'Analyse wegen ungültigem Standardmodell gestoppt.'
    );
    return;
  }

  try {
    let analysisText = job.text;
    const speakers = job.speakers || {};
    const segments = job.segments || [];

    if (segments.length > 0 && Object.keys(speakers).length > 0) {
      analysisText = buildTextWithSpeakers(segments, speakers);
    }

    if (analysisText !== job.text) {
      await query(
        'UPDATE transcriptions SET text = $1, updated_at = NOW() WHERE id = $2',
        [analysisText, transcriptionId]
      );
      await addTranscriptionEvent({
        transcriptionId,
        userId,
        stage: 'analyzing',
        message: 'Sprechernamen in den Text übernommen.',
      });
    }

    const analysis = await withUserCostLock(userId, async () => {
      const costCheck = await checkCostLimit(userId);
      if (!costCheck.allowed) {
        throw new CostLimitExceededError(costCheck.currentCost, costCheck.limit);
      }

      const resolvedTemplate = await resolveTemplate(job.template, userId);
      const { analysis, usage: analysisUsage, model: analysisModel } = await analyzeTranscription(
        analysisText,
        resolvedTemplate,
        apiKey,
        job.custom_prompt || '',
        resolveChatModel(job.model || preferredModelFallback) || preferredModelFallback,
        language
      );

      await logUsage(userId, analysisModel, 'analysis', analysisUsage);
      return analysis;
    });

    await query(
      "UPDATE transcriptions SET status = 'completed', analysis = $1, updated_at = NOW() WHERE id = $2",
      [JSON.stringify(analysis), transcriptionId]
    );
    await addTranscriptionEvent({
      transcriptionId,
      userId,
      stage: 'completed',
      message: 'Manuelle KI-Analyse abgeschlossen.',
    });
  } catch (error) {
    if (error?.code === 'COST_LIMIT_EXCEEDED') {
      await markManualAnalysisError(
        transcriptionId,
        userId,
        error.message,
        'Analyse wegen erreichtem Kostenlimit gestoppt.'
      );
      return;
    }

    logApiError(`Manual analysis ${transcriptionId} failed`, error);
    await markManualAnalysisError(
      transcriptionId,
      userId,
      'Analyse fehlgeschlagen. Bitte erneut versuchen.',
      'Fehler während der manuellen KI-Analyse.'
    );
  }
}
