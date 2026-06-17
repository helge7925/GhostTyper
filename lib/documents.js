import crypto from 'crypto';
import { query } from './db';

const OCR_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
]);

export function inferDocumentSourceType(row = {}) {
  if (row.source === 'vexa') return 'meeting';
  if (row.template === 'translation') return 'translation';
  if (row.analysis_type === 'table' || row.template === 'data_table') return 'data_table';
  if (OCR_MIME_TYPES.has(row.mime_type)) return 'ocr';
  return 'audio_transcription';
}

export function embeddingHash(text, model) {
  return crypto.createHash('sha256').update(`${model}\0${text || ''}`).digest('hex');
}

export async function upsertDocumentForTranscription({
  transcriptionId,
  organizationId,
  ownerUserId,
  visibility = 'private',
  sourceType,
  title,
  mimeType = null,
  fileSize = null,
  status = 'ready',
  folderId = null,
  isFavorite = false,
  textPreview = null,
}) {
  if (!transcriptionId || !organizationId || !ownerUserId) return null;

  const normalizedTitle = String(title || `Datei #${transcriptionId}`).slice(0, 255);
  const normalizedVisibility = visibility === 'workspace' ? 'workspace' : 'private';

  const result = await query(
    `INSERT INTO documents (
       organization_id, owner_user_id, visibility, source_type, title, mime_type, file_size,
       status, folder_id, is_favorite, text_preview, transcription_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (transcription_id) WHERE transcription_id IS NOT NULL
     DO UPDATE SET
       title = EXCLUDED.title,
       mime_type = EXCLUDED.mime_type,
       file_size = EXCLUDED.file_size,
       status = EXCLUDED.status,
       folder_id = EXCLUDED.folder_id,
       is_favorite = EXCLUDED.is_favorite,
       text_preview = EXCLUDED.text_preview,
       updated_at = NOW()
     RETURNING *`,
    [
      organizationId,
      ownerUserId,
      normalizedVisibility,
      sourceType || 'audio_transcription',
      normalizedTitle,
      mimeType,
      fileSize,
      status || 'ready',
      folderId,
      Boolean(isFavorite),
      textPreview ? String(textPreview).slice(0, 1000) : null,
      transcriptionId,
    ],
  );

  return result.rows[0] || null;
}

export async function upsertDocumentFromTranscription(transcriptionId, organizationId, visibility = 'private') {
  const result = await query(
    `SELECT id, user_id, organization_id, original_name, filename, file_size, mime_type, status,
            folder_id, is_favorite, text, source, template, analysis_type
       FROM transcriptions
      WHERE id = $1 AND organization_id = $2`,
    [transcriptionId, organizationId],
  );
  const row = result.rows[0];
  if (!row) return null;

  return upsertDocumentForTranscription({
    transcriptionId: row.id,
    organizationId: row.organization_id,
    ownerUserId: row.user_id,
    visibility,
    sourceType: inferDocumentSourceType(row),
    title: row.original_name || row.filename || `Datei #${row.id}`,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    status: row.status,
    folderId: row.folder_id,
    isFavorite: row.is_favorite,
    textPreview: row.text,
  });
}
