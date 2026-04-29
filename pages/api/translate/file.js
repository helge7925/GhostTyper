import formidable from 'formidable';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { query } from '../../../lib/db';
import { translateTextSegments } from '../../../lib/ai-service';
import {
  CostLimitCheckUnavailableError,
  CostLimitExceededError,
  enforceProjectedBudgetGuardrail,
  estimateTextTransformCost,
  logUsage,
  checkCostLimit,
  withUserCostLock,
} from '../../../lib/usage';
import { getSettingsRow, resolveStoredApiKey } from '../../../lib/settings-service';
import { resolveChatModel } from '../../../lib/model-policy';
import { ACCEPTED_OFFICE_TRANSLATION_TYPES, MAX_FILE_SIZE, MAX_TRANSLATE_INPUT_LENGTH } from '../../../lib/constants';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { detectOfficeMimeType, extensionFromDetectedMime } from '../../../lib/file-signature';
import { inspectOfficeDocumentBuffer, translateOfficeDocumentBuffer } from '../../../lib/office-translation';
import { scanFileForViruses } from '../../../lib/virus-scan';
import { logAuditEvent } from '../../../lib/audit-log';
import { addTranscriptionEvent } from '../../../lib/transcription-events';

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

function safeDownloadName(filename, extension) {
  const base = String(filename || 'dokument')
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100) || 'dokument';
  return `${base}_translated${extension}`;
}

function addUsage(total, usage = {}) {
  return {
    prompt_tokens: (total.prompt_tokens || 0) + (usage.prompt_tokens || usage.input_tokens || 0),
    completion_tokens: (total.completion_tokens || 0) + (usage.completion_tokens || usage.output_tokens || 0),
  };
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
    keyPrefix: 'translate-file',
    identifier: `user:${session.user.id}`,
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
    const detectedMimeType = await detectOfficeMimeType(tempUploadPath);
    if (!detectedMimeType || !ACCEPTED_OFFICE_TRANSLATION_TYPES.includes(detectedMimeType)) {
      await safeUnlink(tempUploadPath);
      tempUploadPath = '';
      return res.status(400).json({ message: 'Ungültiges Dateiformat. Erlaubt sind DOCX, XLSX und PPTX.' });
    }

    const scanResult = await scanFileForViruses(tempUploadPath);
    if (!scanResult.clean) {
      await safeUnlink(tempUploadPath);
      tempUploadPath = '';
      await logAuditEvent({
        userId: session.user.id,
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
    const inputBuffer = await readFile(tempUploadPath);
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

    const settingsRow = await getSettingsRow(session.user.id);
    const apiKey = resolveStoredApiKey(settingsRow) || process.env.MISTRAL_API_KEY;
    const preferredModel = resolveChatModel(requestModel || settingsRow?.preferred_model || 'mistral-large-latest');
    if (!apiKey) {
      await safeUnlink(tempUploadPath);
      tempUploadPath = '';
      return res.status(400).json({ message: 'Kein Mistral API-Key konfiguriert' });
    }
    if (!preferredModel) {
      await safeUnlink(tempUploadPath);
      tempUploadPath = '';
      return res.status(400).json({ message: 'Ungültiges KI-Modell' });
    }

    let totalUsage = {};
    const translated = await withUserCostLock(session.user.id, async () => {
      const costCheck = await checkCostLimit(session.user.id);
      if (!costCheck.allowed) {
        throw new CostLimitExceededError(costCheck.currentCost, costCheck.limit);
      }
      const estimatedCost = estimateTextTransformCost(preferredModel, inspection.text, {
        inputBufferTokens: inspection.segmentCount * 8,
        outputMultiplier: 1.15,
        outputBufferTokens: inspection.segmentCount * 8,
      });
      await enforceProjectedBudgetGuardrail(session.user.id, estimatedCost);

      const output = await translateOfficeDocumentBuffer(inputBuffer, detectedMimeType, {
        translator: async (segments) => {
          const result = await translateTextSegments(segments, targetLanguage, sourceLanguage, apiKey, preferredModel);
          totalUsage = addUsage(totalUsage, result.usage);
          return result.translations;
        },
      });

      await logUsage(session.user.id, preferredModel, 'office_translation', totalUsage);
      return output;
    });

    const extension = extensionFromDetectedMime(detectedMimeType);
    const outputFilename = `${randomUUID()}${extension}`;
    outputPath = path.join(UPLOAD_DIR, outputFilename);
    await writeFile(outputPath, translated.buffer);

    const downloadName = safeDownloadName(file.originalFilename, extension);
    const historyResult = await query(
      `INSERT INTO transcriptions (user_id, filename, original_name, file_path, file_size, mime_type, status, template, text, model)
       VALUES ($1, $2, $3, $4, $5, $6, 'completed', 'translation', $7, $8)
       RETURNING id`,
      [
        session.user.id,
        outputFilename,
        downloadName,
        outputPath,
        translated.buffer.length,
        detectedMimeType,
        `Office-Datei wurde nach ${targetLanguage} übersetzt. Formatstruktur wurde beibehalten; ${translated.stats.segmentCount} Textsegmente wurden ersetzt.`,
        preferredModel,
      ]
    );
    await addTranscriptionEvent({
      transcriptionId: historyResult.rows[0].id,
      userId: session.user.id,
      stage: 'completed',
      message: 'Office-Dateiübersetzung abgeschlossen.',
      meta: {
        segmentCount: translated.stats.segmentCount,
        warningCount: translated.stats.warningCount,
      },
    });

    await logAuditEvent({
      userId: session.user.id,
      action: 'office_translation.completed',
      targetType: 'transcription',
      targetId: String(historyResult.rows[0].id),
      metadata: {
        originalName: file.originalFilename || null,
        outputName: downloadName,
        mimeType: detectedMimeType,
        targetLanguage,
        sourceLanguage,
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
      return res.status(413).json({ message: 'Datei ist zu groß (max. 50 MB)' });
    }
    logApiError('Office translation error', error);
    return serverError(res, 'Office-Dateiübersetzung fehlgeschlagen');
  }
}
