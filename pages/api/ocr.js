import formidable from 'formidable';
import { copyFile, unlink, mkdir, readFile } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { query } from '../../lib/db';
import { withOrgScope } from '../../lib/api/with-org-scope';
import { performOCR, analyzeTranscription } from '../../lib/ai-service';
import {
  budgetIdempotencyKey,
  composeAbortSignals,
  executeReservedSpend,
  estimateTextUsage,
  requestBudgetScope,
} from '../../lib/budget-runtime';
import { ACCEPTED_OCR_TYPES, MAX_CUSTOM_PROMPT_LENGTH, MAX_FILE_SIZE, normalizeAnalysisTemplate } from '../../lib/constants';
import { resolveChatModel } from '../../lib/model-policy';
import { getSettingsRow, resolveCortecsConfig, resolveMistralApiKey } from '../../lib/settings-service';
import { enforceRateLimit, logApiError, serverError } from '../../lib/api-utils';
import { addTranscriptionEvent } from '../../lib/transcription-events';
import { resolveTemplate } from '../../lib/template-service';
import { scanFileForViruses } from '../../lib/virus-scan';
import { detectOcrMimeType, extensionFromDetectedMime } from '../../lib/file-signature';
import { normalizeDataTableAnalysis } from '../../lib/data-table';
import { normalizeAndValidateTableAnalysis } from '../../lib/table-analysis';
import { logAuditEvent } from '../../lib/audit-log';
import { upsertDocumentForTranscription } from '../../lib/documents';
import {
  assertClientCaptureScope,
  findCaptureReplay,
  isCaptureUniqueViolation,
  normalizeClientCaptureId,
} from '../../lib/capture-idempotency';

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

async function estimateOcrPages(filePath, mimeType) {
  if (mimeType !== 'application/pdf') return 1;
  const bytes = await readFile(filePath);
  const matches = bytes.toString('latin1').match(/\/Type\s*\/Page(?!s)\b/g);
  const sizeBound = Math.ceil(bytes.length / (250 * 1024));
  return Math.min(10_000, Math.max(1, matches?.length || 0, sizeBound));
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

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const userId = req.userId;
  const orgId = req.org.id;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'upload-ocr',
    identifier: `org:${orgId}:user:${userId}`,
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

    const clientCaptureId = normalizeClientCaptureId(
      fields.clientCaptureId?.[0] || fields.clientCaptureId,
    );
    assertClientCaptureScope({
      clientCaptureId,
      clientCaptureUserId: fields.clientCaptureUserId?.[0] || fields.clientCaptureUserId,
      clientCaptureOrganizationId: fields.clientCaptureOrganizationId?.[0] || fields.clientCaptureOrganizationId,
      requestUserId: userId,
      requestOrganizationId: orgId,
    });
    const replay = await findCaptureReplay({ organizationId: orgId, userId, clientCaptureId });
    if (replay) {
      await safeUnlink(tempUploadPath);
      tempUploadPath = '';
      return res.status(200).json({
        transcriptionId: replay.id,
        markdown: replay.text || '',
        analysis: replay.analysis || null,
        idempotentReplay: true,
      });
    }

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

    const settingsRow = await getSettingsRow(userId);
    const mistralApiKey = await resolveMistralApiKey({ userId, organizationId: req.org?.id });
    const cortecs = await resolveCortecsConfig({ userId, organizationId: req.org?.id });
    const preferredModel = resolveChatModel(settingsRow?.preferred_model, null) || cortecs.chatModel;
    const language = settingsRow?.language || 'de';
    const shouldAnalyze = (fields.analyze?.[0] || fields.analyze) === 'true';

    if (!mistralApiKey) {
      await safeUnlink(persistedFilePath);
      persistedFilePath = '';
      return res.status(400).json({ message: 'Kein Mistral API-Key für OCR konfiguriert' });
    }
    if (shouldAnalyze && !cortecs.apiKey) {
      await safeUnlink(persistedFilePath);
      persistedFilePath = '';
      return res.status(400).json({ message: 'Kein Cortecs API-Key für Analyse konfiguriert' });
    }
    if (!preferredModel) {
      await safeUnlink(persistedFilePath);
      persistedFilePath = '';
      return res.status(400).json({ message: 'Ungültiges Standardmodell in den Einstellungen' });
    }

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
      ? (resolveChatModel(requestModel, null) || preferredModel)
      : preferredModel;
    if (shouldAnalyze && !selectedModelForAnalysis) {
      await safeUnlink(persistedFilePath);
      persistedFilePath = '';
      return res.status(400).json({ message: 'Ungültiges KI-Modell' });
    }

    let resolvedTemplateForAnalysis = null;
    const budgetScope = clientCaptureId
      ? budgetIdempotencyKey('ocr-capture', orgId, userId, clientCaptureId)
      : requestBudgetScope(req, 'ocr', file.originalFilename || filename);
    const estimatedPages = await estimateOcrPages(filePath, detectedMimeType);
    const { markdown } = await executeReservedSpend(
      {
        idempotencyKey: `${budgetScope}:ocr`,
        organizationId: orgId,
        userId,
        operation: 'ocr',
        provider: 'mistral',
        model: 'mistral-ocr-latest',
        estimatedUsage: { inputQuantity: estimatedPages, outputQuantity: 0 },
      },
      (_reservation, budgetSignal) => performOCR(filePath, mistralApiKey, detectedMimeType, {
        signal: composeAbortSignals(budgetSignal),
      }),
      (result) => ({
        ...(result.usage || {}),
        inputQuantity: result.usage?.pages_processed || result.usage?.pages || estimatedPages,
        outputQuantity: 0,
      }),
    );

    let analysis = null;
    let selectedModelForSave = 'mistral-ocr-latest';
    if (shouldAnalyze && markdown.trim()) {
      resolvedTemplateForAnalysis = await resolveTemplate(template, userId);
      const analysisResult = await executeReservedSpend(
        {
          idempotencyKey: `${budgetScope}:analysis`,
          organizationId: orgId,
          userId,
          operation: 'analysis',
          provider: 'cortecs',
          model: selectedModelForAnalysis,
          estimatedUsage: estimateTextUsage(`${markdown}\n${effectiveCustomPrompt}`, {
            inputBufferTokens: 1600,
            outputMultiplier: 0.8,
            outputBufferTokens: 3500,
          }),
        },
        (_reservation, budgetSignal) => analyzeTranscription(
          markdown,
          resolvedTemplateForAnalysis,
          cortecs.apiKey,
          effectiveCustomPrompt,
          selectedModelForAnalysis,
          language,
          { baseUrl: cortecs.baseUrl, preference: cortecs.preference, signal: composeAbortSignals(budgetSignal) },
        ),
      );
      analysis = analysisResult.analysis;
      selectedModelForSave = selectedModelForAnalysis;
    }

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
    let transcriptionResult;
    try {
      transcriptionResult = await query(
      `INSERT INTO transcriptions (user_id, organization_id, filename, original_name, file_path, file_size, mime_type, template, model, custom_prompt, status, text, analysis, analysis_type, analysis_meta, table_schema, client_capture_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'completed', $11, $12, $13, $14, $15, $16)
       RETURNING id`,
      [
        userId,
        orgId,
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
        clientCaptureId,
      ]
      );
    } catch (error) {
      if (!isCaptureUniqueViolation(error)) throw error;
      const racedReplay = await findCaptureReplay({ organizationId: orgId, userId, clientCaptureId });
      if (!racedReplay) throw error;
      await safeUnlink(persistedFilePath);
      persistedFilePath = '';
      return res.status(200).json({
        transcriptionId: racedReplay.id,
        markdown: racedReplay.text || '',
        analysis: racedReplay.analysis || null,
        idempotentReplay: true,
      });
    }

    const transcriptionId = transcriptionResult.rows[0].id;
    await upsertDocumentForTranscription({
      transcriptionId,
      organizationId: orgId,
      ownerUserId: userId,
      visibility: 'private',
      sourceType: analysisType === 'table' ? 'data_table' : 'ocr',
      title: file.originalFilename,
      mimeType: detectedMimeType,
      fileSize: file.size,
      status: 'completed',
      textPreview: markdown,
    });
    await addTranscriptionEvent({
      transcriptionId,
      userId,
      organizationId: orgId,
      stage: 'completed',
      message: shouldAnalyze
        ? 'OCR und KI-Analyse abgeschlossen.'
        : 'OCR abgeschlossen.',
    });
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: shouldAnalyze ? 'ocr.analysis.completed' : 'ocr.completed',
      targetType: 'transcription',
      targetId: String(transcriptionId),
      metadata: {
        originalName: file.originalFilename || null,
        mimeType: detectedMimeType,
        template,
        analysisType,
        size: Number(file.size || 0),
      },
    });

    // Local file cleanup is handled by transcription detail deletion eventually,
    // but for now we keep it as it's the source.
    persistedFilePath = '';

    return res.status(200).json({ transcriptionId, markdown, analysis });
  } catch (error) {
    if (error?.code === 'INVALID_CLIENT_CAPTURE_ID' || error?.code === 'CAPTURE_SCOPE_REQUIRED') {
      await safeUnlink(tempUploadPath);
      await safeUnlink(persistedFilePath);
      return res.status(400).json({ message: error.message });
    }
    if (error?.code === 'CAPTURE_SCOPE_MISMATCH') {
      await safeUnlink(tempUploadPath);
      await safeUnlink(persistedFilePath);
      return res.status(409).json({ message: error.message, code: error.code });
    }
    if (error?.code === 'BUDGET_EXCEEDED') {
      return res.status(429).json({ message: error.message });
    }
    if (error?.code === 'BUDGET_ACCOUNTING_UNAVAILABLE' || error?.code === 'PRICING_CONFIGURATION_MISSING') {
      return res.status(503).json({ message: error.message });
    }
    logApiError('OCR error', error);
    await safeUnlink(tempUploadPath);
    await safeUnlink(persistedFilePath);
    return serverError(res, 'OCR fehlgeschlagen');
  }
}

export default withOrgScope({ permission: 'paid.execute' }, handler);
