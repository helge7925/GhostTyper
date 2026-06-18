import formidable from 'formidable';
import { copyFile, mkdir, readFile, unlink } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { query } from '../../../lib/db';
import { withOrgScope } from '../../../lib/api/with-org-scope';
import { hasPermission } from '../../../lib/permissions';
import { performOCR } from '../../../lib/ai-service';
import {
  CostLimitCheckUnavailableError,
  CostLimitExceededError,
  checkCostLimit,
  logUsage,
  withUserCostLock,
} from '../../../lib/usage';
import { ACCEPTED_OCR_TYPES, MAX_DOCUMENT_TEXT_LENGTH, MAX_FILE_SIZE } from '../../../lib/constants';
import { resolveMistralApiKey } from '../../../lib/settings-service';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { addTranscriptionEvent } from '../../../lib/transcription-events';
import { scanFileForViruses } from '../../../lib/virus-scan';
import { detectOcrMimeType, extensionFromDetectedMime } from '../../../lib/file-signature';
import { logAuditEvent } from '../../../lib/audit-log';
import { upsertDocumentForTranscription } from '../../../lib/documents';
import { autoIndexDocument } from '../../../lib/document-index';

export const config = { api: { bodyParser: false } };

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.text']);

async function safeUnlink(filePath) {
  if (!filePath) return;
  await unlink(filePath).catch(() => {});
}

function parseForm(req) {
  const form = formidable({ maxFileSize: MAX_FILE_SIZE, keepExtensions: true });
  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => (err ? reject(err) : resolve({ fields, files })));
  });
}

async function conversationExists(conversationId, orgId, userId) {
  const result = await query(
    'SELECT id FROM chat_conversations WHERE id = $1 AND organization_id = $2 AND user_id = $3',
    [conversationId, orgId, userId],
  );
  return result.rowCount > 0;
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ message: 'Method not allowed' });
  }
  if (!hasPermission(req.role, 'chat.write')) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Keine Berechtigung.' });
  }

  const userId = req.userId;
  const orgId = req.org.id;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'chat-upload',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 20,
    windowMs: 60_000,
  }, 'Zu viele Uploads. Bitte später erneut versuchen.');
  if (!allowed) return;

  let persistedFilePath = '';
  let tempUploadPath = '';
  try {
    await mkdir(UPLOAD_DIR, { recursive: true });
    const { fields, files } = await parseForm(req);

    const convId = Number(fields.conversationId?.[0] || fields.conversationId);
    if (!Number.isFinite(convId)) {
      return res.status(400).json({ message: 'Ungültige Chat-ID' });
    }
    if (!(await conversationExists(convId, orgId, userId))) {
      return res.status(404).json({ message: 'Chat nicht gefunden' });
    }

    const file = files.file?.[0] || files.file;
    if (!file) {
      return res.status(400).json({ message: 'Keine Datei hochgeladen' });
    }
    tempUploadPath = file.filepath || '';

    const scanResult = await scanFileForViruses(tempUploadPath);
    if (!scanResult.clean) {
      await safeUnlink(tempUploadPath);
      return res.status(400).json({ message: 'Datei wurde vom Sicherheits-Scan blockiert' });
    }

    // Decide processing path: OCR (PDF/image) vs. plain text (.txt/.md).
    const detectedMimeType = await detectOcrMimeType(tempUploadPath);
    const ext = path.extname(file.originalFilename || '').toLowerCase();
    const isOcr = detectedMimeType && ACCEPTED_OCR_TYPES.includes(detectedMimeType);
    const isText = TEXT_EXTENSIONS.has(ext) || /^text\//.test(String(file.mimetype || ''));

    if (!isOcr && !isText) {
      await safeUnlink(tempUploadPath);
      return res.status(400).json({ message: 'Dateityp wird im Chat nicht unterstützt (PDF, Bild, TXT, MD).' });
    }

    const finalMime = isOcr ? detectedMimeType : 'text/plain';
    const fileExt = isOcr ? (extensionFromDetectedMime(detectedMimeType) || '.bin') : (ext || '.txt');
    const filename = `${randomUUID()}${fileExt}`;
    const filePath = path.join(UPLOAD_DIR, filename);
    await copyFile(tempUploadPath, filePath);
    persistedFilePath = filePath;
    await safeUnlink(tempUploadPath);
    tempUploadPath = '';

    // Extract text.
    let extractedText = '';
    let savedModel = 'text';
    if (isOcr) {
      const mistralApiKey = await resolveMistralApiKey({ userId, organizationId: orgId });
      if (!mistralApiKey) {
        await safeUnlink(persistedFilePath);
        return res.status(400).json({ message: 'Kein Mistral API-Key für OCR konfiguriert' });
      }
      const ocr = await withUserCostLock(userId, async () => {
        const costCheck = await checkCostLimit(userId, orgId);
        if (!costCheck.allowed) {
          throw new CostLimitExceededError(costCheck.currentCost, costCheck.limit);
        }
        const result = await performOCR(filePath, mistralApiKey, finalMime);
        await logUsage(userId, result.model, 'ocr', result.usage, orgId);
        return result;
      });
      extractedText = String(ocr.markdown || '').slice(0, MAX_DOCUMENT_TEXT_LENGTH);
      savedModel = 'mistral-ocr-latest';
    } else {
      const raw = await readFile(filePath, 'utf8');
      extractedText = String(raw || '').slice(0, MAX_DOCUMENT_TEXT_LENGTH);
    }

    if (!extractedText.trim()) {
      await safeUnlink(persistedFilePath);
      return res.status(400).json({ message: 'Aus der Datei konnte kein Text gelesen werden.' });
    }

    // Persist as a transcription + document so it joins the regular pipeline.
    const transcriptionResult = await query(
      `INSERT INTO transcriptions (user_id, organization_id, filename, original_name, file_path, file_size, mime_type, template, model, status, text)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'generic', $8, 'completed', $9)
       RETURNING id`,
      [userId, orgId, filename, file.originalFilename, filePath, file.size, finalMime, savedModel, extractedText],
    );
    const transcriptionId = transcriptionResult.rows[0].id;

    const document = await upsertDocumentForTranscription({
      transcriptionId,
      organizationId: orgId,
      ownerUserId: userId,
      visibility: 'private',
      sourceType: isOcr ? 'ocr' : 'text',
      title: file.originalFilename || filename,
      mimeType: finalMime,
      fileSize: file.size,
      status: 'completed',
      textPreview: extractedText,
    });

    // Attach to the conversation (idempotent), then index in the background.
    await query(
      `INSERT INTO chat_context_items (conversation_id, organization_id, context_type, document_id)
       SELECT $1, $2, 'document', $3
       WHERE NOT EXISTS (
         SELECT 1 FROM chat_context_items
          WHERE conversation_id = $1 AND organization_id = $2 AND context_type = 'document' AND document_id = $3
       )`,
      [convId, orgId, document.id],
    );
    void autoIndexDocument({ documentId: document.id, transcriptionId, organizationId: orgId, userId });

    await addTranscriptionEvent({
      transcriptionId,
      userId,
      organizationId: orgId,
      stage: 'completed',
      message: isOcr ? 'Datei im Chat hochgeladen (OCR).' : 'Datei im Chat hochgeladen.',
    });
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: 'chat.upload',
      targetType: 'chat_conversation',
      targetId: String(convId),
      metadata: { documentId: document.id, sourceType: isOcr ? 'ocr' : 'text', size: Number(file.size || 0) },
    });

    persistedFilePath = '';
    return res.status(201).json({
      documentId: document.id,
      title: document.title,
      indexStatus: 'processing',
    });
  } catch (error) {
    await safeUnlink(tempUploadPath);
    await safeUnlink(persistedFilePath);
    if (error?.code === 'COST_LIMIT_EXCEEDED') {
      return res.status(429).json({ message: error.message });
    }
    if (error instanceof CostLimitCheckUnavailableError || error?.code === 'COST_CHECK_UNAVAILABLE') {
      return res.status(503).json({ message: error.message });
    }
    logApiError('Chat upload error', error);
    return serverError(res, 'Datei konnte nicht hochgeladen werden.');
  }
}

export default withOrgScope({ permission: 'chat.read' }, handler);
