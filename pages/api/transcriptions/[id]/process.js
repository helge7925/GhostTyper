import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../auth/[...nextauth]';
import { query } from '../../../../lib/db';
import { transcribeAudio, analyzeTranscription } from '../../../../lib/ai-service';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const { id } = req.query;

  const transcription = await query(
    'SELECT id, file_path, template, status FROM transcriptions WHERE id = $1 AND user_id = $2',
    [id, session.user.id]
  );

  if (transcription.rows.length === 0) {
    return res.status(404).json({ message: 'Transkription nicht gefunden' });
  }

  const job = transcription.rows[0];

  if (job.status !== 'pending') {
    return res.status(400).json({ message: `Transkription hat Status "${job.status}" und kann nicht erneut gestartet werden` });
  }

  // Get user's Mistral API key or fall back to server key
  const settingsResult = await query(
    'SELECT mistral_api_key FROM settings WHERE user_id = $1',
    [session.user.id]
  );
  const apiKey = settingsResult.rows[0]?.mistral_api_key || process.env.MISTRAL_API_KEY;

  if (!apiKey) {
    return res.status(400).json({ message: 'Kein Mistral API-Key konfiguriert. Bitte in den Einstellungen hinterlegen.' });
  }

  // Set status to processing
  await query(
    "UPDATE transcriptions SET status = 'processing', updated_at = NOW() WHERE id = $1",
    [id]
  );

  // Start processing (non-blocking response)
  res.status(202).json({ message: 'Transkription gestartet', status: 'processing' });

  // Process in background
  try {
    const text = await transcribeAudio(job.file_path, apiKey);
    const analysis = await analyzeTranscription(text, job.template, apiKey);

    await query(
      "UPDATE transcriptions SET status = 'completed', text = $1, analysis = $2, updated_at = NOW() WHERE id = $3",
      [text, JSON.stringify(analysis), id]
    );
  } catch (error) {
    console.error(`Transcription ${id} failed:`, error);
    await query(
      "UPDATE transcriptions SET status = 'error', error = $1, updated_at = NOW() WHERE id = $2",
      [error.message, id]
    );
  }
}
