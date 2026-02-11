import formidable from 'formidable';
import { copyFile, unlink, mkdir } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';
import { query, resolveTemplate } from '../../lib/db';
import { performOCR, analyzeTranscription } from '../../lib/ai-service';
import { logUsage, checkCostLimit } from '../../lib/usage';
import { ACCEPTED_OCR_TYPES, MAX_FILE_SIZE } from '../../lib/constants';

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

  let filePath = '';
  try {
    await ensureUploadDir();
    const { fields, files } = await parseForm(req);
    const file = files.file?.[0] || files.file;

    if (!file) {
      return res.status(400).json({ message: 'Keine Datei hochgeladen' });
    }

    if (!ACCEPTED_OCR_TYPES.includes(file.mimetype)) {
      return res.status(400).json({ message: 'Ungültiges Dateiformat. Erlaubt sind PDF, PNG, JPG, WEBP.' });
    }

    const ext = path.extname(file.originalFilename || '.pdf');
    const filename = `${randomUUID()}${ext}`;
    filePath = path.join(UPLOAD_DIR, filename);

    await copyFile(file.filepath, filePath);
    await unlink(file.filepath).catch(() => {});

    // Get user settings
    const settingsResult = await query(
      'SELECT mistral_api_key, preferred_model, language FROM settings WHERE user_id = $1',
      [session.user.id]
    );
    const apiKey = settingsResult.rows[0]?.mistral_api_key || process.env.MISTRAL_API_KEY;
    const preferredModel = settingsResult.rows[0]?.preferred_model || 'mistral-large-latest';
    const language = settingsResult.rows[0]?.language || 'de';

    if (!apiKey) {
      return res.status(400).json({ message: 'Kein Mistral API-Key konfiguriert' });
    }

    // Check cost limit
    const costCheck = await checkCostLimit(session.user.id);
    if (!costCheck.allowed) {
      return res.status(429).json({
        message: `Monatliches Kostenlimit erreicht (${costCheck.currentCost.toFixed(2)} / ${costCheck.limit.toFixed(2)} €)`,
      });
    }

    // Perform OCR
    const { markdown, usage: ocrUsage, model: ocrModel } = await performOCR(filePath, apiKey, file.mimetype);
    await logUsage(session.user.id, ocrModel, 'ocr', ocrUsage);

    let analysis = null;

    // Optional: Further analysis with LLM
    const shouldAnalyze = (fields.analyze?.[0] || fields.analyze) === 'true';
    if (shouldAnalyze && markdown.trim()) {
      const template = fields.template?.[0] || fields.template || 'generic';
      const customPrompt = fields.customPrompt?.[0] || fields.customPrompt || '';
      const requestModel = fields.model?.[0] || fields.model;
      
      const resolvedTemplate = await resolveTemplate(template, session.user.id);

      const analysisResult = await analyzeTranscription(
        markdown, 
        resolvedTemplate, 
        apiKey, 
        customPrompt, 
        requestModel || preferredModel, 
        language
      );
      await logUsage(session.user.id, analysisResult.model, 'analysis', analysisResult.usage);
      analysis = analysisResult.analysis;
    }

    // Save OCR result as a transcription record in the history
    const transcriptionResult = await query(
      `INSERT INTO transcriptions (user_id, filename, original_name, file_path, file_size, mime_type, template, model, custom_prompt, status, text, analysis)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'completed', $10, $11)
       RETURNING id`,
      [
        session.user.id,
        filename,
        file.originalFilename,
        filePath,
        file.size,
        file.mimetype,
        fields.template?.[0] || fields.template || 'generic',
        fields.model?.[0] || fields.model || 'mistral-ocr-latest',
        fields.customPrompt?.[0] || fields.customPrompt || '',
        markdown,
        analysis ? JSON.stringify(analysis) : null
      ]
    );

    const transcriptionId = transcriptionResult.rows[0].id;

    // Local file cleanup is handled by transcription detail deletion eventually,
    // but for now we keep it as it's the source.

    return res.status(200).json({ transcriptionId, markdown, analysis });
  } catch (error) {
    console.error('OCR error:', error);
    if (filePath) await unlink(filePath).catch(() => {});
    return res.status(500).json({ message: error.message || 'OCR fehlgeschlagen' });
  }
}