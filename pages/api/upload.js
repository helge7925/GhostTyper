import formidable from 'formidable';
import { copyFile, unlink, mkdir } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { query } from '../../lib/db';
import { ACCEPTED_AUDIO_TYPES, MAX_CUSTOM_PROMPT_LENGTH, MAX_FILE_SIZE, normalizeAnalysisTemplate } from '../../lib/constants';
import { resolveChatModel } from '../../lib/model-policy';
import { enforceRateLimit, logApiError, serverError } from '../../lib/api-utils';
import { addTranscriptionEvent } from '../../lib/transcription-events';
import { scanFileForViruses } from '../../lib/virus-scan';
import { logAuditEvent } from '../../lib/audit-log';
import { detectAudioMimeType, extensionFromDetectedMime } from '../../lib/file-signature';
import { withOrgScope } from '../../lib/api/with-org-scope';
import { upsertDocumentForTranscription } from '../../lib/documents';

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

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const userId = req.userId;
  const orgId = req.org.id;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'upload-audio',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 30,
    windowMs: 60_000,
  }, 'Zu viele Uploads. Bitte später erneut versuchen.');
  if (!allowed) return;

  let tempUploadPath = '';
  let persistedFilePath = '';
  try {
    await ensureUploadDir();

    const { fields, files } = await parseForm(req);
    const file = files.file?.[0] || files.file;

    if (!file) {
      return res.status(400).json({ message: 'Keine Datei hochgeladen' });
    }

    const rawMimeType = (file.mimetype || '').toString();
    const reportedMimeType = rawMimeType.split(';')[0];
    tempUploadPath = file.filepath || '';
    const detectedMimeType = await detectAudioMimeType(tempUploadPath);

    if (!detectedMimeType || (!ACCEPTED_AUDIO_TYPES.includes(detectedMimeType) && !detectedMimeType.startsWith('audio/'))) {
      await safeUnlink(tempUploadPath);
      tempUploadPath = '';
      return res.status(400).json({ message: 'Ungültiges Dateiformat' });
    }

    const scanResult = await scanFileForViruses(tempUploadPath);
    if (!scanResult.clean) {
      await safeUnlink(tempUploadPath);
      tempUploadPath = '';
      await logAuditEvent({
        userId,
        organizationId: orgId,
        action: 'upload.virus_detected',
        targetType: 'upload',
        targetId: file.originalFilename || null,
        severity: 'warn',
        metadata: {
          mode: scanResult.mode,
          detail: scanResult.detail,
          mimeType: detectedMimeType,
          reportedMimeType: reportedMimeType || null,
          size: Number(file.size || 0),
        },
      });
      return res.status(400).json({ message: 'Datei wurde vom Sicherheits-Scan blockiert' });
    }

    const ext = extensionFromDetectedMime(detectedMimeType) || '.bin';
    const filename = `${randomUUID()}${ext}`;
    const filePath = path.join(UPLOAD_DIR, filename);

    await copyFile(tempUploadPath, filePath);
    persistedFilePath = filePath;
    await safeUnlink(tempUploadPath);
    tempUploadPath = '';

    const template = normalizeAnalysisTemplate(fields.template?.[0] || fields.template || 'generic');
    const requestedModel = fields.model?.[0] || fields.model || 'deepseek-v4-pro';
    const model = resolveChatModel(requestedModel);
    if (!model) {
      await safeUnlink(persistedFilePath);
      persistedFilePath = '';
      return res.status(400).json({ message: 'Ungültiges KI-Modell' });
    }
    const diarize = (fields.diarize?.[0] || fields.diarize) === 'true';
    const customPrompt = fields.customPrompt?.[0] || fields.customPrompt || '';
    const analysisFocus = fields.analysisFocus?.[0] || fields.analysisFocus || '';
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
    const normalizedCustomPrompt = typeof customPrompt === 'string' ? customPrompt.trim() : '';
    const normalizedAnalysisFocus = typeof analysisFocus === 'string' ? analysisFocus.trim() : '';
    const combinedPrompt = [
      normalizedCustomPrompt,
      normalizedAnalysisFocus ? `Fokus der Analyse:\n${normalizedAnalysisFocus}` : '',
    ].filter(Boolean).join('\n\n');
    if (combinedPrompt.length > MAX_CUSTOM_PROMPT_LENGTH) {
      await safeUnlink(persistedFilePath);
      persistedFilePath = '';
      return res.status(400).json({ message: `Kombinierter Analysekontext ist zu lang (max. ${MAX_CUSTOM_PROMPT_LENGTH} Zeichen)` });
    }
    const autoAnalyze = (fields.autoAnalyze?.[0] || fields.autoAnalyze) !== 'false';

    const result = await query(
      `INSERT INTO transcriptions (user_id, organization_id, filename, original_name, file_path, file_size, mime_type, template, model, diarize, custom_prompt, auto_analyze, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending')
       RETURNING id, filename, original_name, status, template, model, diarize, auto_analyze, created_at`,
      [userId, orgId, filename, file.originalFilename, filePath, file.size, detectedMimeType, template, model, diarize, combinedPrompt || null, autoAnalyze]
    );
    await upsertDocumentForTranscription({
      transcriptionId: result.rows[0].id,
      organizationId: orgId,
      ownerUserId: userId,
      visibility: 'private',
      sourceType: 'audio_transcription',
      title: file.originalFilename,
      mimeType: detectedMimeType,
      fileSize: file.size,
      status: result.rows[0].status,
      textPreview: null,
    });

    await addTranscriptionEvent({
      transcriptionId: result.rows[0].id,
      userId,
      organizationId: orgId,
      stage: 'queued',
      message: 'Upload abgeschlossen. Wartet auf Start der Verarbeitung.',
    });
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: 'upload.created',
      targetType: 'transcription',
      targetId: String(result.rows[0].id),
      metadata: {
        originalName: file.originalFilename || null,
        mimeType: detectedMimeType,
        reportedMimeType: reportedMimeType || null,
        size: Number(file.size || 0),
        scan: {
          skipped: Boolean(scanResult.skipped),
          mode: scanResult.mode,
        },
      },
    });

    // File ownership is now transferred to transcription lifecycle management.
    persistedFilePath = '';
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    logApiError('Upload error', error);
    await safeUnlink(tempUploadPath);
    await safeUnlink(persistedFilePath);
    if (error.code === 'LIMIT_FILE_SIZE' || error.message?.includes('maxFileSize')) {
      return res.status(413).json({ message: 'Datei ist zu groß (max. 50 MB)' });
    }
    return serverError(res, 'Upload fehlgeschlagen');
  }
}

export default withOrgScope({ permission: 'transcription.write' }, handler);
