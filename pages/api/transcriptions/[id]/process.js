import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../auth/[...nextauth]';
import { query } from '../../../../lib/db';
import { transcribeAudio, analyzeTranscription, buildTextWithSpeakers } from '../../../../lib/ai-service';
import { logUsage, checkCostLimit } from '../../../../lib/usage';

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
    'SELECT id, file_path, template, diarize, custom_prompt, auto_analyze, status FROM transcriptions WHERE id = $1 AND user_id = $2',
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
    'SELECT mistral_api_key, context_bias, preferred_model, language FROM settings WHERE user_id = $1',
    [session.user.id]
  );
  const apiKey = settingsResult.rows[0]?.mistral_api_key || process.env.MISTRAL_API_KEY;
  const preferredModel = settingsResult.rows[0]?.preferred_model || null;
  const language = settingsResult.rows[0]?.language || 'de';
  const contextBias = settingsResult.rows[0]?.context_bias
    ? settingsResult.rows[0].context_bias.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  if (!apiKey) {
    return res.status(400).json({ message: 'Kein Mistral API-Key konfiguriert. Bitte in den Einstellungen hinterlegen.' });
  }

  // Check cost limit
  const costCheck = await checkCostLimit(session.user.id);
  if (!costCheck.allowed) {
    return res.status(429).json({
      message: `Monatliches Kostenlimit erreicht (${costCheck.currentCost.toFixed(2)} / ${costCheck.limit.toFixed(2)} EUR)`,
    });
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
    const { text, segments, usage: transcriptionUsage, model: transcriptionModel } = await transcribeAudio(job.file_path, apiKey, {
      diarize: job.diarize,
      contextBias,
      language,
    });

    // Log transcription usage
    await logUsage(session.user.id, transcriptionModel, 'transcription', transcriptionUsage);

    if (job.diarize && segments.length > 0) {
      // Two-step workflow: stop at 'transcribed' so user can assign speaker names
      await query(
        "UPDATE transcriptions SET status = 'transcribed', text = $1, segments = $2, updated_at = NOW() WHERE id = $3",
        [text, JSON.stringify(segments), id]
      );
    } else if (!job.auto_analyze) {
      // Transcription-only mode: stop at 'transcribed' without analysis
      await query(
        "UPDATE transcriptions SET status = 'transcribed', text = $1, updated_at = NOW() WHERE id = $2",
        [text, id]
      );
    } else {
      // Auto-analyze: go straight to analysis
      await query(
        "UPDATE transcriptions SET status = 'analyzing', text = $1, updated_at = NOW() WHERE id = $2",
        [text, id]
      );

      const { analysis, usage: analysisUsage, model: analysisModel } = await analyzeTranscription(text, job.template, apiKey, job.custom_prompt || '', preferredModel, language);

      // Log analysis usage
      await logUsage(session.user.id, analysisModel, 'analysis', analysisUsage);

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
