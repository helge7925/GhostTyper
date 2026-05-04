import { analyzeTranscription, buildTextWithSpeakers } from './ai-service';
import { logApiError } from './api-utils';
import { query } from './db';
import { resolveChatModel } from './model-policy';
import { getSettingsRow, resolveMistralApiKey } from './settings-service';
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

async function markManualAnalysisError(transcriptionId, userId, message, eventMessage, organizationId = null) {
  await query(
    "UPDATE transcriptions SET status = 'error', error = $1, updated_at = NOW() WHERE id = $2",
    [message, transcriptionId]
  );
  await addTranscriptionEvent({
    transcriptionId,
    userId,
    organizationId,
    stage: 'error',
    message: eventMessage || message,
  });
}

export async function runManualAnalysisJob({ transcriptionId, userId, organizationId = null }) {
  // organizationId is optional for backwards-compat. When provided we scope
  // the cost-lock and usage rows to it; we also load it from the row when
  // missing so older callers (worker, legacy admin tools) still get correct
  // org tagging.
  const result = await query(
    'SELECT id, organization_id, text, segments, speakers, template, model, custom_prompt, status, source FROM transcriptions WHERE id = $1 AND user_id = $2',
    [transcriptionId, userId]
  );
  const job = result.rows[0];
  if (!job || job.status !== 'analyzing') return;
  const orgId = organizationId ?? job.organization_id ?? null;

  const settingsRow = await getSettingsRow(userId);
  const apiKey = await resolveMistralApiKey({ userId, organizationId: orgId });
  const preferredModelFallback = resolveChatModel(settingsRow?.preferred_model || 'mistral-large-latest');
  const language = settingsRow?.language || 'de';

  if (!apiKey) {
    await markManualAnalysisError(
      transcriptionId,
      userId,
      'Kein Mistral API-Key konfiguriert',
      'Analyse ohne API-Key nicht möglich.',
      orgId
    );
    return;
  }
  if (!preferredModelFallback) {
    await markManualAnalysisError(
      transcriptionId,
      userId,
      'Ungültiges Standardmodell in den Einstellungen',
      'Analyse wegen ungültigem Standardmodell gestoppt.',
      orgId
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
        organizationId: orgId,
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
      const costCheck = await checkCostLimit(userId, orgId);
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

      await logUsage(userId, analysisModel, 'analysis', analysisUsage, orgId);
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
        organizationId: orgId,
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
        organizationId: orgId,
        stage: 'completed',
        message: `Datentabelle abgeschlossen. ${tableAnalysis.rows?.length || 0} Zeilen extrahiert.`,
      });
    } else {
      // Standard text analysis. If the LLM produced a title, lift it
      // into `original_name` so vexa-meeting rows stop showing the
      // placeholder ("Remote Meeting · Teams · 04.05.…") in lists.
      // Source-discriminator: only do this for vexa rows; uploaded
      // files keep their original filename.
      const llmTitle =
        (analysis && (analysis.titel || analysis.title)) || null;
      const cleanedTitle = typeof llmTitle === 'string'
        ? llmTitle.trim().replace(/^["'„“]|["'„“]$/g, '').slice(0, 160)
        : null;
      const isVexaRow = job.source === 'vexa';

      await query(
        `UPDATE transcriptions
         SET status = 'completed',
             analysis = $1,
             analysis_type = 'text',
             analysis_meta = NULL,
             table_schema = $2,
             original_name = CASE
               WHEN $4::boolean AND $5::text IS NOT NULL AND length($5::text) > 0
                 THEN $5::text
               ELSE original_name
             END,
             updated_at = NOW()
             WHERE id = $3`,
        [JSON.stringify(analysis), null, transcriptionId, isVexaRow, cleanedTitle]
      );

      await addTranscriptionEvent({
        transcriptionId,
        userId,
        organizationId: orgId,
        stage: 'completed',
        message: cleanedTitle && isVexaRow
          ? `Manuelle KI-Analyse abgeschlossen. Titel: "${cleanedTitle.slice(0, 80)}"`
          : 'Manuelle KI-Analyse abgeschlossen.',
      });
    }

  } catch (error) {
    if (error?.code === 'COST_LIMIT_EXCEEDED') {
      await markManualAnalysisError(
        transcriptionId,
        userId,
        error.message,
        'Analyse wegen erreichtem Kostenlimit gestoppt.',
        orgId
      );
      return;
    }
    if (error instanceof CostLimitCheckUnavailableError || error?.code === 'COST_CHECK_UNAVAILABLE') {
      await markManualAnalysisError(
        transcriptionId,
        userId,
        error.message,
        'Analyse pausiert: Kostenlimit-Prüfung aktuell nicht verfügbar.',
        orgId
      );
      return;
    }

    logApiError(`Manual analysis ${transcriptionId} failed`, error);
    await markManualAnalysisError(
      transcriptionId,
      userId,
      'Analyse fehlgeschlagen. Bitte erneut versuchen.',
      'Fehler während der manuellen KI-Analyse.',
      orgId
    );
  }
}
