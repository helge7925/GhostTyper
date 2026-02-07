import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../auth/[...nextauth]';
import { query } from '../../../../lib/db';
import { transcribeAudio, analyzeTranscription, buildTextWithSpeakers } from '../../../../lib/ai-service';

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
    'SELECT id, file_path, template, diarize, custom_prompt, status FROM transcriptions WHERE id = $1 AND user_id = $2',
    [id, session.user.id]
  );

  if (transcription.rows.length === 0) {
    return res.status(404).json({ message: 'Transkription nicht gefunden' });
  }

  const job = transcription.rows[0];

  if (job.status !== 'pending') {
    return res.status(400).json({ message: `Transkription hat Status "${job.status}" und kann nicht erneut gestartet werden` });
  }

  // Get user's settings (API key + context_bias)
  const settingsResult = await query(
    'SELECT mistral_api_key, context_bias FROM settings WHERE user_id = $1',
    [session.user.id]
  );
  const apiKey = settingsResult.rows[0]?.mistral_api_key || process.env.MISTRAL_API_KEY;
  const contextBias = settingsResult.rows[0]?.context_bias
    ? settingsResult.rows[0].context_bias.split(',').map(s => s.trim()).filter(Boolean)
    : [];

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
    const { text, segments } = await transcribeAudio(job.file_path, apiKey, {
      diarize: job.diarize,
      contextBias,
      language: 'de',
    });

    if (job.diarize && segments.length > 0) {
      // Two-step workflow: stop at 'transcribed' so user can assign speaker names
      await query(
        "UPDATE transcriptions SET status = 'transcribed', text = $1, segments = $2, updated_at = NOW() WHERE id = $3",
        [text, JSON.stringify(segments), id]
      );
    } else {
      // No diarization: go straight to analysis
      await query(
        "UPDATE transcriptions SET status = 'analyzing', text = $1, updated_at = NOW() WHERE id = $2",
        [text, id]
      );

      const analysis = await analyzeTranscription(text, job.template, apiKey, job.custom_prompt || '');

      await query(
        "UPDATE transcriptions SET status = 'completed', analysis = $1, updated_at = NOW() WHERE id = $2",
        [JSON.stringify(analysis), id]
      );
    }
  } catch (error) {
    console.error(`Transcription ${id} failed:`, error);
    await query(
      "UPDATE transcriptions SET status = 'error', error = $1, updated_at = NOW() WHERE id = $2",
      [error.message, id]
    );
  }
}
