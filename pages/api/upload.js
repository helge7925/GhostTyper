import formidable from 'formidable';
import { copyFile, unlink, mkdir } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';
import { query } from '../../lib/db';
import { ACCEPTED_AUDIO_TYPES, MAX_FILE_SIZE } from '../../lib/constants';

export const config = {
  api: {
    bodyParser: false,
  },
};

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

async function ensureUploadDir() {
  await mkdir(UPLOAD_DIR, { recursive: true });
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

  try {
    await ensureUploadDir();

    const { fields, files } = await parseForm(req);
    const file = files.file?.[0] || files.file;

    if (!file) {
      return res.status(400).json({ message: 'Keine Datei hochgeladen' });
    }

    const mimetype = file.mimetype.split(';')[0];
    const extension = path.extname(file.originalFilename || '').toLowerCase();
    const isAllowedExt = ['.mp3', '.wav', '.ogg', '.webm', '.m4a', '.mp4', '.flac', '.aac'].includes(extension);

    if (!ACCEPTED_AUDIO_TYPES.includes(mimetype) && !mimetype.startsWith('audio/') && !isAllowedExt) {
      return res.status(400).json({ message: 'Ungültiges Dateiformat' });
    }

    const ext = path.extname(file.originalFilename || '.mp3');
    const filename = `${randomUUID()}${ext}`;
    const filePath = path.join(UPLOAD_DIR, filename);

    await copyFile(file.filepath, filePath);
    await unlink(file.filepath).catch(() => {});

    const template = fields.template?.[0] || fields.template || 'meeting';
    const model = fields.model?.[0] || fields.model || 'mistral-large-latest';
    const diarize = (fields.diarize?.[0] || fields.diarize) === 'true';
    const customPrompt = fields.customPrompt?.[0] || fields.customPrompt || null;
    const autoAnalyze = (fields.autoAnalyze?.[0] || fields.autoAnalyze) !== 'false';

    const result = await query(
      `INSERT INTO transcriptions (user_id, filename, original_name, file_path, file_size, mime_type, template, model, diarize, custom_prompt, auto_analyze, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending')
       RETURNING id, filename, original_name, status, template, model, diarize, auto_analyze, created_at`,
      [session.user.id, filename, file.originalFilename, filePath, file.size, file.mimetype, template, model, diarize, customPrompt, autoAnalyze]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Upload error:', error);
    if (error.code === 'LIMIT_FILE_SIZE' || error.message?.includes('maxFileSize')) {
      return res.status(413).json({ message: 'Datei ist zu groß (max. 50 MB)' });
    }
    return res.status(500).json({ message: 'Upload fehlgeschlagen' });
  }
}
