import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { query } from '../../../lib/db';
import { analyzeTranscription } from '../../../lib/ai-service';
import {
  CostLimitCheckUnavailableError,
  CostLimitExceededError,
  checkCostLimit,
  logUsage,
  withUserCostLock,
} from '../../../lib/usage';
import { resolveChatModel } from '../../../lib/model-policy';
import { getSettingsRow, resolveStoredApiKey } from '../../../lib/settings-service';
import { MAX_CUSTOM_PROMPT_LENGTH, MAX_DOCUMENT_TEXT_LENGTH } from '../../../lib/constants';
import { resolveTemplate } from '../../../lib/template-service';
import { addTranscriptionEvent } from '../../../lib/transcription-events';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { normalizeDataTableAnalysis } from '../../../lib/data-table';

const ALLOWED_TEMPLATES = new Set(['data_table']);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'knowledge-prep-text',
    identifier: `user:${session.user.id}`,
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

    const settingsRow = await getSettingsRow(session.user.id);
    const apiKey = resolveStoredApiKey(settingsRow) || process.env.MISTRAL_API_KEY;
    const language = settingsRow?.language || 'de';
    const selectedModel = resolveChatModel(requestModel || settingsRow?.preferred_model || 'mistral-large-latest');

    if (!apiKey) {
      return res.status(400).json({ message: 'Kein Mistral API-Key konfiguriert.' });
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

    const { analysis, usedModel } = await withUserCostLock(session.user.id, async () => {
      const costCheck = await checkCostLimit(session.user.id);
      if (!costCheck.allowed) {
        throw new CostLimitExceededError(costCheck.currentCost, costCheck.limit);
      }

      const resolvedTemplate = await resolveTemplate(template, session.user.id);
      const analysisResult = await analyzeTranscription(
        text,
        resolvedTemplate,
        apiKey,
        mergedPrompt,
        selectedModel,
        language
      );
      await logUsage(session.user.id, analysisResult.model, 'analysis', analysisResult.usage);

      return {
        analysis: analysisResult.analysis,
        usedModel: analysisResult.model,
      };
    });

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
      `INSERT INTO transcriptions (user_id, filename, original_name, file_path, file_size, mime_type, status, template, model, custom_prompt, text, analysis, analysis_type, analysis_meta, table_schema, auto_analyze, diarize)
       VALUES ($1, $2, $3, $4, $5, $6, 'completed', $7, $8, $9, $10, $11, $12, $13, $14, false, false)
       RETURNING id, original_name, status, template, created_at`,
      [
        session.user.id,
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
    await addTranscriptionEvent({
      transcriptionId: transcription.id,
      userId: session.user.id,
      stage: 'completed',
      message: `${titlePrefix}-Analyse aus Text abgeschlossen.`,
    });

    return res.status(200).json(transcription);
  } catch (error) {
    if (error?.code === 'COST_LIMIT_EXCEEDED') {
      return res.status(429).json({ message: error.message });
    }
    if (error instanceof CostLimitCheckUnavailableError || error?.code === 'COST_CHECK_UNAVAILABLE') {
      return res.status(503).json({ message: error.message });
    }
    logApiError('Knowledge prep text error', error);
    return serverError(res, 'Wissensaufbereitung fehlgeschlagen');
  }
}
