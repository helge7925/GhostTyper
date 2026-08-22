import { query } from '../../../lib/db';
import { withOrgScope } from '../../../lib/api/with-org-scope';
import { analyzeTranscription } from '../../../lib/ai-service';
import { composeAbortSignals, executeReservedSpend, estimateTextUsage, requestBudgetScope } from '../../../lib/budget-runtime';
import { resolveConfiguredModel } from '../../../lib/openrouter';
import { getSettingsRow, resolveOpenRouterConfig } from '../../../lib/settings-service';
import { MAX_CUSTOM_PROMPT_LENGTH, MAX_DOCUMENT_TEXT_LENGTH } from '../../../lib/constants';
import { resolveTemplate } from '../../../lib/template-service';
import { addTranscriptionEvent } from '../../../lib/transcription-events';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { normalizeDataTableAnalysis } from '../../../lib/data-table';
import { upsertDocumentForTranscription } from '../../../lib/documents';

const ALLOWED_TEMPLATES = new Set(['data_table']);

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const userId = req.userId;
  const orgId = req.org.id;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'knowledge-prep-text',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!allowed) return;

  try {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    const template = typeof req.body?.template === 'string' ? req.body.template.trim() : '';
    const customPrompt = typeof req.body?.customPrompt === 'string' ? req.body.customPrompt.trim() : '';
    const analysisFocus = typeof req.body?.analysisFocus === 'string' ? req.body.analysisFocus.trim() : '';
    const requestModel = typeof req.body?.model === 'string' ? req.body.model.trim() : '';

    if (!text) {
      return res.status(400).json({ message: 'Text ist erforderlich.' });
    }
    if (text.length > MAX_DOCUMENT_TEXT_LENGTH) {
      return res.status(400).json({ message: `Text ist zu lang (max. ${MAX_DOCUMENT_TEXT_LENGTH} Zeichen).` });
    }
    if (!ALLOWED_TEMPLATES.has(template)) {
      return res.status(400).json({ message: 'Ungültiger Wissensaufbereitungs-Modus.' });
    }
    if (customPrompt.length > MAX_CUSTOM_PROMPT_LENGTH) {
      return res.status(400).json({ message: `Zusätzlicher Kontext ist zu lang (max. ${MAX_CUSTOM_PROMPT_LENGTH} Zeichen).` });
    }
    if (analysisFocus.length > MAX_CUSTOM_PROMPT_LENGTH) {
      return res.status(400).json({ message: `Fokus der Analyse ist zu lang (max. ${MAX_CUSTOM_PROMPT_LENGTH} Zeichen).` });
    }

    const settingsRow = await getSettingsRow(userId);
    const openrouter = await resolveOpenRouterConfig({ userId, organizationId: req.org?.id });
    const language = settingsRow?.language || 'de';
    const selectedModel = resolveConfiguredModel(openrouter, 'chat', requestModel || settingsRow?.preferred_model);

    if (!openrouter.apiKey) {
      return res.status(400).json({ message: 'Kein OpenRouter-API-Key konfiguriert.' });
    }
    if (!selectedModel) {
      return res.status(400).json({ message: 'Ungültiges KI-Modell.' });
    }

    const focusLabel = language === 'en' ? 'Analysis focus' : 'Fokus der Analyse';
    const mergedPrompt = [
      customPrompt,
      analysisFocus ? `${focusLabel}:\n${analysisFocus}` : '',
    ].filter(Boolean).join('\n\n');
    if (mergedPrompt.length > MAX_CUSTOM_PROMPT_LENGTH) {
      return res.status(400).json({ message: `Kombinierter Analysekontext ist zu lang (max. ${MAX_CUSTOM_PROMPT_LENGTH} Zeichen).` });
    }

    const resolvedTemplate = await resolveTemplate(template, userId);
    const analysisResult = await executeReservedSpend(
      {
        idempotencyKey: requestBudgetScope(req, 'knowledge-prep', { text, template, mergedPrompt, selectedModel }),
        organizationId: orgId,
        userId,
        operation: 'knowledge_prep',
        provider: 'openrouter',
        model: selectedModel,
        estimatedUsage: estimateTextUsage(`${text}\n${mergedPrompt}`, {
          inputBufferTokens: 1200,
          outputMultiplier: 1,
          outputBufferTokens: 3000,
        }),
      },
      (_reservation, budgetSignal) => analyzeTranscription(
        text,
        resolvedTemplate,
        openrouter.apiKey,
        mergedPrompt,
        selectedModel,
        language,
        { baseUrl: openrouter.baseUrl, fallbackModel: openrouter.defaultModels.chat, signal: composeAbortSignals(budgetSignal) },
      ),
    );
    const analysis = analysisResult.analysis;
    const usedModel = analysisResult.model;

    const titlePrefix = 'Datentabelle';

    let analysisType = 'text';
    let analysisPayload = analysis || {};
    let analysisMeta = null;
    let tableSchema = null;

    if (template === 'data_table') {
      const tableAnalysis = normalizeDataTableAnalysis(analysis, language);
      analysisType = 'table';
      analysisPayload = { rows: tableAnalysis.rows };
      analysisMeta = tableAnalysis.meta;
      tableSchema = tableAnalysis.schema;
    }

    const result = await query(
      `INSERT INTO transcriptions (user_id, organization_id, filename, original_name, file_path, file_size, mime_type, status, template, model, custom_prompt, text, analysis, analysis_type, analysis_meta, table_schema, auto_analyze, diarize)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', $8, $9, $10, $11, $12, $13, $14, $15, false, false)
       RETURNING id, original_name, status, template, created_at`,
      [
        userId,
        orgId,
        null,
        `${titlePrefix} (Text)`,
        null,
        Buffer.byteLength(text, 'utf8'),
        'text/plain',
        template,
        usedModel,
        mergedPrompt || null,
        text,
        JSON.stringify(analysisPayload),
        analysisType,
        analysisMeta ? JSON.stringify(analysisMeta) : null,
        tableSchema ? JSON.stringify(tableSchema) : null,
      ]
    );

    const transcription = result.rows[0];
    await upsertDocumentForTranscription({
      transcriptionId: transcription.id,
      organizationId: orgId,
      ownerUserId: userId,
      visibility: 'private',
      sourceType: 'data_table',
      title: transcription.original_name,
      mimeType: 'text/plain',
      fileSize: Buffer.byteLength(text, 'utf8'),
      status: transcription.status,
      textPreview: text,
    });
    await addTranscriptionEvent({
      transcriptionId: transcription.id,
      userId,
      organizationId: orgId,
      stage: 'completed',
      message: `${titlePrefix}-Analyse aus Text abgeschlossen.`,
    });

    return res.status(200).json(transcription);
  } catch (error) {
    if (error?.code === 'BUDGET_EXCEEDED') {
      return res.status(429).json({ message: error.message });
    }
    if (error?.code === 'BUDGET_ACCOUNTING_UNAVAILABLE' || error?.code === 'PRICING_CONFIGURATION_MISSING') {
      return res.status(503).json({ message: error.message });
    }
    logApiError('Knowledge prep text error', error);
    return serverError(res, 'Wissensaufbereitung fehlgeschlagen');
  }
}

export default withOrgScope({ permission: 'paid.execute' }, handler);
