import { analyzeTranscription, buildTextWithSpeakers } from './ai-service';
import { logApiError } from './api-utils';
import { query } from './db';
import { resolveChatModel } from './model-policy';
import { getSettingsRow, resolveStoredApiKey } from './settings-service';
import { addTranscriptionEvent } from './transcription-events';
import { resolveTemplate } from './template-service';
import {
  CostLimitCheckUnavailableError,
  CostLimitExceededError,
  checkCostLimit,
  logUsage,
  withUserCostLock,
} from './usage';
import { normalizeAndValidateTableAnalysis } from './table-analysis';
import { normalizeDataTableAnalysis } from './data-table';

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

    // Get template and check if it's a table template
    const resolvedTemplate = await resolveTemplate(job.template, userId);
    const isTableTemplate = resolvedTemplate?.template_type === 'table';
    const tableSchema = resolvedTemplate?.table_schema;
    const isBuiltinDataTableTemplate = resolvedTemplate?.name === 'data_table' || job.template === 'data_table';

    const analysis = await withUserCostLock(userId, async () => {
      const costCheck = await checkCostLimit(userId);
      if (!costCheck.allowed) {
        throw new CostLimitExceededError(costCheck.currentCost, costCheck.limit);
      }

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

    // Store analysis with appropriate type
    if (isTableTemplate && tableSchema) {
      const tableAnalysis = normalizeAndValidateTableAnalysis(analysis, tableSchema);

      await query(
        `UPDATE transcriptions 
         SET status = 'completed', 
             analysis = $1, 
             analysis_type = 'table',
             analysis_meta = $2,
             table_schema = $3,
             updated_at = NOW() 
        WHERE id = $4`,
        [
          JSON.stringify({ metadata: tableAnalysis.metadata, rows: tableAnalysis.rows }),
          JSON.stringify({
            missing_fields_by_row: tableAnalysis.missing_fields_by_row,
            missing_metadata_fields: tableAnalysis.missing_metadata_fields,
            unvollstaendige_daten: tableAnalysis.unvollstaendige_daten,
            extrahierte_zeilen_anzahl: tableAnalysis.extrahierte_zeilen_anzahl,
            zusammenfassung: tableAnalysis.zusammenfassung,
          }),
          tableSchema,
          transcriptionId,
        ]
      );

      await addTranscriptionEvent({
        transcriptionId,
        userId,
        stage: 'completed',
        message: `Tabellen-Analyse abgeschlossen. ${tableAnalysis.rows?.length || 0} Zeilen extrahiert.`,
      });
    } else if (isBuiltinDataTableTemplate) {
      const tableAnalysis = normalizeDataTableAnalysis(analysis, language);

      await query(
        `UPDATE transcriptions
         SET status = 'completed',
             analysis = $1,
             analysis_type = 'table',
             analysis_meta = $2,
             table_schema = $3,
             updated_at = NOW()
         WHERE id = $4`,
        [
          JSON.stringify({ rows: tableAnalysis.rows }),
          JSON.stringify(tableAnalysis.meta),
          tableAnalysis.schema,
          transcriptionId,
        ]
      );

      await addTranscriptionEvent({
        transcriptionId,
        userId,
        stage: 'completed',
        message: `Datentabelle abgeschlossen. ${tableAnalysis.rows?.length || 0} Zeilen extrahiert.`,
      });
    } else {
      // Standard text analysis
      await query(
        `UPDATE transcriptions 
         SET status = 'completed', 
             analysis = $1, 
             analysis_type = 'text',
             analysis_meta = NULL,
             table_schema = $2,
             updated_at = NOW() 
             WHERE id = $3`,
        [JSON.stringify(analysis), null, transcriptionId]
      );

      await addTranscriptionEvent({
        transcriptionId,
        userId,
        stage: 'completed',
        message: 'Manuelle KI-Analyse abgeschlossen.',
      });
    }

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
    if (error instanceof CostLimitCheckUnavailableError || error?.code === 'COST_CHECK_UNAVAILABLE') {
      await markManualAnalysisError(
        transcriptionId,
        userId,
        error.message,
        'Analyse pausiert: Kostenlimit-Prüfung aktuell nicht verfügbar.'
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
