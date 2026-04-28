import formidable from 'formidable';
import { copyFile, unlink, mkdir } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';
import { query } from '../../lib/db';
import { performOCR, analyzeTranscription } from '../../lib/ai-service';
import {
  CostLimitCheckUnavailableError,
  CostLimitExceededError,
  logUsage,
  checkCostLimit,
  withUserCostLock,
} from '../../lib/usage';
import { ACCEPTED_OCR_TYPES, MAX_CUSTOM_PROMPT_LENGTH, MAX_FILE_SIZE, normalizeAnalysisTemplate } from '../../lib/constants';
import { resolveChatModel } from '../../lib/model-policy';
import { getSettingsRow, resolveStoredApiKey } from '../../lib/settings-service';
import { enforceRateLimit, logApiError, serverError } from '../../lib/api-utils';
import { addTranscriptionEvent } from '../../lib/transcription-events';
import { resolveTemplate } from '../../lib/template-service';
import { scanFileForViruses } from '../../lib/virus-scan';
import { detectOcrMimeType, extensionFromDetectedMime } from '../../lib/file-signature';
import { normalizeDataTableAnalysis } from '../../lib/data-table';
import { normalizeAndValidateTableAnalysis } from '../../lib/table-analysis';

export const config = {
  api: {
    bodyParser: false,
  },
};

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

async function ensureUploadDir() {
  await mkdir(UPLOAD_DIR, { recursive: true });
}

async function safeUnlink(filePath) {
  if (!filePath) return;
  await unlink(filePath).catch(() => {});
}

function parseForm(req) {
  const form = formidable({
    maxFileSize: MAX_FILE_SIZE,
    keepExtensions: true,
  });

  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'upload-ocr',
    identifier: `user:${session.user.id}`,
    limit: 20,
    windowMs: 60_000,
  }, 'Zu viele OCR-Anfragen. Bitte später erneut versuchen.');
  if (!allowed) return;

  let persistedFilePath = '';
  let tempUploadPath = '';
  try {
    await ensureUploadDir();
    const { fields, files } = await parseForm(req);
    const file = files.file?.[0] || files.file;

    if (!file) {
      return res.status(400).json({ message: 'Keine Datei hochgeladen' });
    }

    tempUploadPath = file.filepath || '';
    const detectedMimeType = await detectOcrMimeType(tempUploadPath);
    if (!detectedMimeType || !ACCEPTED_OCR_TYPES.includes(detectedMimeType)) {
      await safeUnlink(tempUploadPath);
      tempUploadPath = '';
      return res.status(400).json({ message: 'Ungültiges Dateiformat. Erlaubt sind PDF, PNG, JPG, WEBP.' });
    }

    const scanResult = await scanFileForViruses(file.filepath);
    if (!scanResult.clean) {
      await safeUnlink(tempUploadPath);
      tempUploadPath = '';
      return res.status(400).json({ message: 'Datei wurde vom Sicherheits-Scan blockiert' });
    }

    const ext = extensionFromDetectedMime(detectedMimeType) || '.bin';
    const filename = `${randomUUID()}${ext}`;
    const filePath = path.join(UPLOAD_DIR, filename);

    await copyFile(file.filepath, filePath);
    persistedFilePath = filePath;
    await safeUnlink(tempUploadPath);
    tempUploadPath = '';

    const settingsRow = await getSettingsRow(session.user.id);
    const apiKey = resolveStoredApiKey(settingsRow) || process.env.MISTRAL_API_KEY;
    const preferredModel = resolveChatModel(settingsRow?.preferred_model || 'mistral-large-latest');
    const language = settingsRow?.language || 'de';

    if (!apiKey) {
      await safeUnlink(persistedFilePath);
      persistedFilePath = '';
      return res.status(400).json({ message: 'Kein Mistral API-Key konfiguriert' });
    }
    if (!preferredModel) {
      await safeUnlink(persistedFilePath);
      persistedFilePath = '';
      return res.status(400).json({ message: 'Ungültiges Standardmodell in den Einstellungen' });
    }

    const shouldAnalyze = (fields.analyze?.[0] || fields.analyze) === 'true';
    const template = normalizeAnalysisTemplate(fields.template?.[0] || fields.template || 'generic');
    const customPrompt = fields.customPrompt?.[0] || fields.customPrompt || '';
    const analysisFocus = fields.analysisFocus?.[0] || fields.analysisFocus || '';
    const documentScope = fields.documentScope?.[0] || fields.documentScope || '';
    if (typeof customPrompt === 'string' && customPrompt.length > MAX_CUSTOM_PROMPT_LENGTH) {
      await safeUnlink(persistedFilePath);
      persistedFilePath = '';
      return res.status(400).json({ message: `Zusätzlicher Kontext ist zu lang (max. ${MAX_CUSTOM_PROMPT_LENGTH} Zeichen)` });
    }
    if (typeof analysisFocus === 'string' && analysisFocus.length > MAX_CUSTOM_PROMPT_LENGTH) {
      await safeUnlink(persistedFilePath);
      persistedFilePath = '';
      return res.status(400).json({ message: `Fokus der Analyse ist zu lang (max. ${MAX_CUSTOM_PROMPT_LENGTH} Zeichen)` });
    }
    if (typeof documentScope === 'string' && documentScope.length > MAX_CUSTOM_PROMPT_LENGTH) {
      await safeUnlink(persistedFilePath);
      persistedFilePath = '';
      return res.status(400).json({ message: `PDF-Bezug ist zu lang (max. ${MAX_CUSTOM_PROMPT_LENGTH} Zeichen)` });
    }

    const normalizedCustomPrompt = typeof customPrompt === 'string' ? customPrompt.trim() : '';
    const normalizedAnalysisFocus = typeof analysisFocus === 'string' ? analysisFocus.trim() : '';
    const normalizedDocumentScope = typeof documentScope === 'string' ? documentScope.trim() : '';
    const documentScopeLabel = language === 'en' ? 'PDF scope' : 'Bezug im PDF';
    const analysisFocusLabel = language === 'en' ? 'Analysis focus' : 'Fokus der Analyse';
    const effectiveCustomPrompt = [
      normalizedCustomPrompt,
      normalizedAnalysisFocus ? `${analysisFocusLabel}:\n${normalizedAnalysisFocus}` : '',
      normalizedDocumentScope ? `${documentScopeLabel}:\n${normalizedDocumentScope}` : '',
    ].filter(Boolean).join('\n\n');

    if (effectiveCustomPrompt.length > MAX_CUSTOM_PROMPT_LENGTH) {
      await safeUnlink(persistedFilePath);
      persistedFilePath = '';
      return res.status(400).json({ message: `Kombinierter Kontext ist zu lang (max. ${MAX_CUSTOM_PROMPT_LENGTH} Zeichen)` });
    }
    const requestModel = fields.model?.[0] || fields.model;
    const selectedModelForAnalysis = shouldAnalyze
      ? resolveChatModel(requestModel || preferredModel)
      : preferredModel;
    if (shouldAnalyze && !selectedModelForAnalysis) {
      await safeUnlink(persistedFilePath);
      persistedFilePath = '';
      return res.status(400).json({ message: 'Ungültiges KI-Modell' });
    }

    let resolvedTemplateForAnalysis = null;
    const { markdown, analysis, selectedModelForSave } = await withUserCostLock(session.user.id, async () => {
      const costCheck = await checkCostLimit(session.user.id);
      if (!costCheck.allowed) {
        throw new CostLimitExceededError(costCheck.currentCost, costCheck.limit);
      }

      const { markdown: markdownValue, usage: ocrUsage, model: ocrModel } = await performOCR(filePath, apiKey, detectedMimeType);
      await logUsage(session.user.id, ocrModel, 'ocr', ocrUsage);

      if (!shouldAnalyze || !markdownValue.trim()) {
        return {
          markdown: markdownValue,
          analysis: null,
          selectedModelForSave: 'mistral-ocr-latest',
        };
      }

      resolvedTemplateForAnalysis = await resolveTemplate(template, session.user.id);
      const analysisResult = await analyzeTranscription(
        markdownValue,
        resolvedTemplateForAnalysis,
        apiKey,
        effectiveCustomPrompt,
        selectedModelForAnalysis,
        language
      );
      await logUsage(session.user.id, analysisResult.model, 'analysis', analysisResult.usage);

      return {
        markdown: markdownValue,
        analysis: analysisResult.analysis,
        selectedModelForSave: selectedModelForAnalysis,
      };
    });

    let analysisType = 'text';
    let analysisPayload = analysis;
    let analysisMeta = null;
    let tableSchema = null;

    if (shouldAnalyze && resolvedTemplateForAnalysis?.template_type === 'table' && resolvedTemplateForAnalysis?.table_schema && analysis) {
      const tableAnalysis = normalizeAndValidateTableAnalysis(analysis, resolvedTemplateForAnalysis.table_schema);
      analysisType = 'table';
      analysisPayload = { metadata: tableAnalysis.metadata, rows: tableAnalysis.rows };
      analysisMeta = {
        missing_fields_by_row: tableAnalysis.missing_fields_by_row,
        missing_metadata_fields: tableAnalysis.missing_metadata_fields,
        unvollstaendige_daten: tableAnalysis.unvollstaendige_daten,
        extrahierte_zeilen_anzahl: tableAnalysis.extrahierte_zeilen_anzahl,
        zusammenfassung: tableAnalysis.zusammenfassung,
      };
      tableSchema = resolvedTemplateForAnalysis.table_schema;
    } else if (shouldAnalyze && template === 'data_table' && analysis) {
      const tableAnalysis = normalizeDataTableAnalysis(analysis, language);
      analysisType = 'table';
      analysisPayload = { rows: tableAnalysis.rows };
      analysisMeta = tableAnalysis.meta;
      tableSchema = tableAnalysis.schema;
    }

    // Save OCR result as a transcription record in the history
    const transcriptionResult = await query(
      `INSERT INTO transcriptions (user_id, filename, original_name, file_path, file_size, mime_type, template, model, custom_prompt, status, text, analysis, analysis_type, analysis_meta, table_schema)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'completed', $10, $11, $12, $13, $14)
       RETURNING id`,
      [
        session.user.id,
        filename,
        file.originalFilename,
        filePath,
        file.size,
        detectedMimeType,
        template,
        selectedModelForSave,
        effectiveCustomPrompt,
        markdown,
        analysisPayload ? JSON.stringify(analysisPayload) : null,
        analysisType,
        analysisMeta ? JSON.stringify(analysisMeta) : null,
        tableSchema ? JSON.stringify(tableSchema) : null,
      ]
    );

    const transcriptionId = transcriptionResult.rows[0].id;
    await addTranscriptionEvent({
      transcriptionId,
      userId: session.user.id,
      stage: 'completed',
      message: shouldAnalyze
        ? 'OCR und KI-Analyse abgeschlossen.'
        : 'OCR abgeschlossen.',
    });

    // Local file cleanup is handled by transcription detail deletion eventually,
    // but for now we keep it as it's the source.
    persistedFilePath = '';

    return res.status(200).json({ transcriptionId, markdown, analysis });
  } catch (error) {
    if (error?.code === 'COST_LIMIT_EXCEEDED') {
      return res.status(429).json({ message: error.message });
    }
    if (error instanceof CostLimitCheckUnavailableError || error?.code === 'COST_CHECK_UNAVAILABLE') {
      return res.status(503).json({ message: error.message });
    }
    logApiError('OCR error', error);
    await safeUnlink(tempUploadPath);
    await safeUnlink(persistedFilePath);
    return serverError(res, 'OCR fehlgeschlagen');
  }
}
