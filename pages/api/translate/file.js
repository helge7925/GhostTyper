import formidable from 'formidable';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { query } from '../../../lib/db';
import { withOrgScope } from '../../../lib/api/with-org-scope';
import { performOCR, translateText, translateTextSegments } from '../../../lib/ai-service';
import {
  CostLimitCheckUnavailableError,
  CostLimitExceededError,
  enforceProjectedBudgetGuardrail,
  estimateTextTransformCost,
  logUsage,
  checkCostLimit,
  withUserCostLock,
} from '../../../lib/usage';
import { getSettingsRow, resolveCortecsConfig, resolveMistralApiKey } from '../../../lib/settings-service';
import { resolveChatModel } from '../../../lib/model-policy';
import {
  ACCEPTED_FILE_TRANSLATION_TYPES,
  ACCEPTED_OFFICE_TRANSLATION_TYPES,
  ACCEPTED_PDF_TRANSLATION_TYPES,
  MAX_FILE_SIZE,
  MAX_TRANSLATE_INPUT_LENGTH,
} from '../../../lib/constants';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { detectTranslatableMimeType, extensionFromDetectedMime } from '../../../lib/file-signature';
import { inspectOfficeDocumentBuffer, translateOfficeDocumentBuffer } from '../../../lib/office-translation';
import { scanFileForViruses } from '../../../lib/virus-scan';
import { logAuditEvent } from '../../../lib/audit-log';
import { addTranscriptionEvent } from '../../../lib/transcription-events';
import { buildTranslatedFilename } from '../../../lib/translate-filename';
import { mdToHtml } from '../../../lib/export-utils';
import { renderPdfBufferFromHtml } from '../../../lib/pdf-export';
import { upsertDocumentForTranscription } from '../../../lib/documents';

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

function safeDownloadName(filename, extension, languageLabel, fallbackLabel = 'translated') {
  return buildTranslatedFilename(filename, extension, languageLabel, fallbackLabel);
}

/**
 * Splits a long markdown string into chunks small enough to translate in one
 * model round-trip. Splits on blank lines (paragraph boundaries) so structure
 * is preserved; never splits a paragraph mid-sentence.
 */
function splitMarkdownIntoSegments(markdown, maxChars = 6000) {
  const paragraphs = String(markdown || '').split(/\n{2,}/);
  const chunks = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (!paragraph) continue;
    if (current && current.length + paragraph.length + 2 > maxChars) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function addUsage(total, usage = {}) {
  return {
    prompt_tokens: (total.prompt_tokens || 0) + (usage.prompt_tokens || usage.input_tokens || 0),
    completion_tokens: (total.completion_tokens || 0) + (usage.completion_tokens || usage.output_tokens || 0),
  };
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const userId = req.userId;
  const orgId = req.org.id;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'translate-file',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 20,
    windowMs: 60_000,
  }, 'Zu viele Dateiübersetzungen. Bitte später erneut versuchen.');
  if (!allowed) return;

  let tempUploadPath = '';
  let outputPath = '';

  try {
    await ensureUploadDir();
    const { fields, files } = await parseForm(req);
    const file = files.file?.[0] || files.file;
    if (!file) {
      return res.status(400).json({ message: 'Keine Datei hochgeladen' });
    }

    tempUploadPath = file.filepath || '';
    const detectedMimeType = await detectTranslatableMimeType(tempUploadPath);
    if (!detectedMimeType || !ACCEPTED_FILE_TRANSLATION_TYPES.includes(detectedMimeType)) {
      await safeUnlink(tempUploadPath);
      tempUploadPath = '';
      return res.status(400).json({ message: 'Ungültiges Dateiformat. Erlaubt sind PDF, DOCX, XLSX und PPTX.' });
    }
    const isPdf = ACCEPTED_PDF_TRANSLATION_TYPES.includes(detectedMimeType);
    const isOffice = ACCEPTED_OFFICE_TRANSLATION_TYPES.includes(detectedMimeType);

    const scanResult = await scanFileForViruses(tempUploadPath);
    if (!scanResult.clean) {
      await safeUnlink(tempUploadPath);
      tempUploadPath = '';
      await logAuditEvent({
        userId,
        organizationId: orgId,
        action: 'office_translation.virus_detected',
        targetType: 'office_translation',
        targetId: file.originalFilename || null,
        severity: 'warn',
        metadata: {
          mode: scanResult.mode,
          detail: scanResult.detail,
          mimeType: detectedMimeType,
          size: Number(file.size || 0),
        },
      });
      return res.status(400).json({ message: 'Datei wurde vom Sicherheits-Scan blockiert' });
    }

    const targetLanguage = fields.targetLanguage?.[0] || fields.targetLanguage || 'German';
    const sourceLanguage = fields.sourceLanguage?.[0] || fields.sourceLanguage || 'auto';
    const requestModel = fields.model?.[0] || fields.model || null;
    const languageLabelRaw = fields.languageLabel?.[0] || fields.languageLabel || '';
    const fallbackLabelRaw = fields.fallbackLabel?.[0] || fields.fallbackLabel || 'translated';
    const inputBuffer = await readFile(tempUploadPath);

    const settingsRow = await getSettingsRow(userId);
    const cortecs = await resolveCortecsConfig({ userId, organizationId: req.org?.id });
    const cortecsApiKey = cortecs.apiKey;
    const mistralApiKey = await resolveMistralApiKey({ userId, organizationId: req.org?.id });
    const preferredModel = resolveChatModel(requestModel || cortecs.chatModel || settingsRow?.preferred_model) || cortecs.chatModel;
    if (!cortecsApiKey) {
      await safeUnlink(tempUploadPath);
      tempUploadPath = '';
      return res.status(400).json({ message: 'Kein Cortecs API-Key konfiguriert' });
    }
    if (!preferredModel) {
      await safeUnlink(tempUploadPath);
      tempUploadPath = '';
      return res.status(400).json({ message: 'Ungültiges KI-Modell' });
    }

    // ====== OFFICE PATH (DOCX/XLSX/PPTX) ======
    if (isOffice) {
      const inspection = await inspectOfficeDocumentBuffer(inputBuffer, detectedMimeType);
      if (inspection.segmentCount === 0) {
        await safeUnlink(tempUploadPath);
        tempUploadPath = '';
        return res.status(400).json({ message: 'Die Datei enthält keinen direkt übersetzbaren Office-Text.' });
      }
      if (inspection.characterCount > MAX_TRANSLATE_INPUT_LENGTH) {
        await safeUnlink(tempUploadPath);
        tempUploadPath = '';
        return res.status(400).json({ message: `Office-Datei enthält zu viel Text (max. ${MAX_TRANSLATE_INPUT_LENGTH} Zeichen)` });
      }

      let totalUsage = {};
      const translated = await withUserCostLock(userId, async () => {
        const costCheck = await checkCostLimit(userId, orgId);
        if (!costCheck.allowed) {
          throw new CostLimitExceededError(costCheck.currentCost, costCheck.limit);
        }
        const estimatedCost = estimateTextTransformCost(preferredModel, inspection.text, {
          inputBufferTokens: inspection.segmentCount * 8,
          outputMultiplier: 1.15,
          outputBufferTokens: inspection.segmentCount * 8,
        });
        await enforceProjectedBudgetGuardrail(userId, estimatedCost, orgId);

        const output = await translateOfficeDocumentBuffer(inputBuffer, detectedMimeType, {
          translator: async (segments) => {
            const result = await translateTextSegments(
              segments,
              targetLanguage,
              sourceLanguage,
              cortecsApiKey,
              preferredModel,
              { baseUrl: cortecs.baseUrl, preference: cortecs.preference },
            );
            totalUsage = addUsage(totalUsage, result.usage);
            return result.translations;
          },
        });

        await logUsage(userId, preferredModel, 'office_translation', totalUsage, orgId);
        return output;
      });

      const extension = extensionFromDetectedMime(detectedMimeType);
      const outputFilename = `${randomUUID()}${extension}`;
      outputPath = path.join(UPLOAD_DIR, outputFilename);
      await writeFile(outputPath, translated.buffer);

      const downloadName = safeDownloadName(file.originalFilename, extension, languageLabelRaw, fallbackLabelRaw);
      const historyResult = await query(
        `INSERT INTO transcriptions (user_id, organization_id, filename, original_name, file_path, file_size, mime_type, status, template, text, model)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', 'translation', $8, $9)
         RETURNING id`,
        [
          userId,
          orgId,
          outputFilename,
          downloadName,
          outputPath,
          translated.buffer.length,
          detectedMimeType,
          `Office-Datei wurde nach ${targetLanguage} übersetzt. Formatstruktur wurde beibehalten; ${translated.stats.segmentCount} Textsegmente wurden ersetzt.`,
          preferredModel,
        ]
      );
      await upsertDocumentForTranscription({
        transcriptionId: historyResult.rows[0].id,
        organizationId: orgId,
        ownerUserId: userId,
        visibility: 'private',
        sourceType: 'translation',
        title: downloadName,
        mimeType: detectedMimeType,
        fileSize: translated.buffer.length,
        status: 'completed',
        textPreview: `Office-Datei wurde nach ${targetLanguage} übersetzt.`,
      });
      await addTranscriptionEvent({
        transcriptionId: historyResult.rows[0].id,
        userId,
        organizationId: orgId,
        stage: 'completed',
        message: 'Office-Dateiübersetzung abgeschlossen.',
        meta: {
          segmentCount: translated.stats.segmentCount,
          warningCount: translated.stats.warningCount,
        },
      });

      await logAuditEvent({
        userId,
        organizationId: orgId,
        action: 'office_translation.completed',
        targetType: 'transcription',
        targetId: String(historyResult.rows[0].id),
        metadata: {
          originalName: file.originalFilename || null,
          outputName: downloadName,
          mimeType: detectedMimeType,
          targetLanguage,
          sourceLanguage,
          languageLabel: languageLabelRaw || null,
          model: preferredModel,
          segmentCount: translated.stats.segmentCount,
          warningCount: translated.stats.warningCount,
        },
      });

      await safeUnlink(tempUploadPath);
      tempUploadPath = '';
      outputPath = '';

      res.setHeader('Content-Type', detectedMimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
      res.setHeader('X-GhostTyper-History-Id', String(historyResult.rows[0].id));
      res.setHeader('X-GhostTyper-Layout-Warnings', String(translated.stats.warningCount || 0));
      return res.status(200).send(translated.buffer);
    }

    // ====== PDF PATH (best-effort: OCR → translate → render new PDF) ======
    if (isPdf) {
      let totalOcrUsage = {};
      let totalTranslateUsage = {};
      let segmentCount = 0;
      let pdfBuffer;

      pdfBuffer = await withUserCostLock(userId, async () => {
        const costCheck = await checkCostLimit(userId, orgId);
        if (!costCheck.allowed) {
          throw new CostLimitExceededError(costCheck.currentCost, costCheck.limit);
        }

        if (!mistralApiKey) {
          throw Object.assign(new Error('Kein Mistral API-Key für OCR konfiguriert'), { code: 'NO_MISTRAL_OCR_KEY' });
        }

        // Step 1: OCR via Mistral — returns Markdown.
        const ocrResult = await performOCR(tempUploadPath, mistralApiKey, 'application/pdf');
        const sourceMarkdown = String(ocrResult?.markdown || '').trim();
        if (ocrResult?.usage) {
          totalOcrUsage = addUsage(totalOcrUsage, ocrResult.usage);
        }
        if (!sourceMarkdown) {
          throw Object.assign(new Error('PDF enthält keinen extrahierbaren Text.'), { code: 'PDF_NO_TEXT' });
        }
        if (sourceMarkdown.length > MAX_TRANSLATE_INPUT_LENGTH) {
          throw Object.assign(
            new Error(`PDF enthält zu viel Text (max. ${MAX_TRANSLATE_INPUT_LENGTH} Zeichen)`),
            { code: 'PDF_TOO_LARGE' },
          );
        }

        // Project the LLM cost for the translation step.
        const estimatedCost = estimateTextTransformCost(preferredModel, sourceMarkdown, {
          outputMultiplier: 1.15,
        });
        await enforceProjectedBudgetGuardrail(userId, estimatedCost, orgId);

        // Step 2: Translate Markdown chunk-by-chunk to keep token windows safe.
        const segments = splitMarkdownIntoSegments(sourceMarkdown, 6000);
        segmentCount = segments.length;
        const translatedSegments = [];
        for (const segment of segments) {
          const result = await translateText(
            segment,
            targetLanguage,
            sourceLanguage,
            cortecsApiKey,
            preferredModel,
            { baseUrl: cortecs.baseUrl, preference: cortecs.preference },
          );
          translatedSegments.push(result?.translatedText || segment);
          if (result?.usage) {
            totalTranslateUsage = addUsage(totalTranslateUsage, result.usage);
          }
        }
        const translatedMarkdown = translatedSegments.join('\n\n');

        // Step 3: Markdown → HTML → PDF via existing Chromium renderer.
        const html = mdToHtml(translatedMarkdown);
        const buffer = await renderPdfBufferFromHtml(html, {});

        await logUsage(userId, 'mistral-ocr-latest', 'ocr', totalOcrUsage, orgId);
        await logUsage(userId, preferredModel, 'translation', totalTranslateUsage, orgId);
        return buffer;
      });

      const extension = '.pdf';
      const outputFilename = `${randomUUID()}${extension}`;
      outputPath = path.join(UPLOAD_DIR, outputFilename);
      await writeFile(outputPath, pdfBuffer);

      const downloadName = safeDownloadName(file.originalFilename, extension, languageLabelRaw, fallbackLabelRaw);
      const historyResult = await query(
        `INSERT INTO transcriptions (user_id, organization_id, filename, original_name, file_path, file_size, mime_type, status, template, text, model)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', 'translation', $8, $9)
         RETURNING id`,
        [
          userId,
          orgId,
          outputFilename,
          downloadName,
          outputPath,
          pdfBuffer.length,
          'application/pdf',
          `PDF wurde nach ${targetLanguage} übersetzt. Layout aus dem Originaltext neu aufgebaut; ${segmentCount} Textsegmente.`,
          preferredModel,
        ]
      );
      await upsertDocumentForTranscription({
        transcriptionId: historyResult.rows[0].id,
        organizationId: orgId,
        ownerUserId: userId,
        visibility: 'private',
        sourceType: 'translation',
        title: downloadName,
        mimeType: 'application/pdf',
        fileSize: pdfBuffer.length,
        status: 'completed',
        textPreview: `PDF wurde nach ${targetLanguage} übersetzt.`,
      });
      await addTranscriptionEvent({
        transcriptionId: historyResult.rows[0].id,
        userId,
        organizationId: orgId,
        stage: 'completed',
        message: 'PDF-Dateiübersetzung abgeschlossen (Best-Effort-Layout).',
        meta: { segmentCount },
      });

      await logAuditEvent({
        userId,
        organizationId: orgId,
        action: 'pdf_translation.completed',
        targetType: 'transcription',
        targetId: String(historyResult.rows[0].id),
        metadata: {
          originalName: file.originalFilename || null,
          outputName: downloadName,
          mimeType: 'application/pdf',
          targetLanguage,
          sourceLanguage,
          languageLabel: languageLabelRaw || null,
          model: preferredModel,
          segmentCount,
        },
      });

      await safeUnlink(tempUploadPath);
      tempUploadPath = '';
      outputPath = '';

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
      res.setHeader('X-GhostTyper-History-Id', String(historyResult.rows[0].id));
      res.setHeader('X-GhostTyper-PDF-Layout-Mode', 'best-effort');
      return res.status(200).send(pdfBuffer);
    }

    // Should never be reached due to whitelist above.
    await safeUnlink(tempUploadPath);
    tempUploadPath = '';
    return res.status(400).json({ message: 'Ungültiges Dateiformat' });
  } catch (error) {
    await safeUnlink(tempUploadPath);
    if (outputPath) await safeUnlink(outputPath);
    if (error?.code === 'COST_LIMIT_EXCEEDED' || error?.code === 'BUDGET_GUARDRAIL_EXCEEDED') {
      return res.status(429).json({ message: error.message });
    }
    if (error instanceof CostLimitCheckUnavailableError || error?.code === 'COST_CHECK_UNAVAILABLE') {
      return res.status(503).json({ message: error.message });
    }
    if (error.code === 'LIMIT_FILE_SIZE' || error.message?.includes('maxFileSize')) {
      return res.status(413).json({ message: 'Datei ist zu groß (max. 500 MB)' });
    }
    if (error?.code === 'PDF_NO_TEXT' || error?.code === 'PDF_TOO_LARGE' || error?.code === 'NO_MISTRAL_OCR_KEY') {
      return res.status(400).json({ message: error.message });
    }
    logApiError('File translation error', error);
    return serverError(res, 'Datei-Übersetzung fehlgeschlagen');
  }
}

export default withOrgScope({ permission: 'transcription.write' }, handler);
