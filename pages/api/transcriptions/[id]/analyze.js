import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../auth/[...nextauth]';
import { query } from '../../../../lib/db';
import { analyzeTranscription, buildTextWithSpeakers } from '../../../../lib/ai-service';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const { id } = req.query;

  const result = await query(
    'SELECT id, text, segments, speakers, template, custom_prompt, status FROM transcriptions WHERE id = $1 AND user_id = $2',
    [id, session.user.id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ message: 'Transkription nicht gefunden' });
  }

  const job = result.rows[0];

  if (job.status !== 'transcribed') {
    return res.status(400).json({ message: `Analyse kann nur im Status "transcribed" gestartet werden (aktuell: "${job.status}")` });
  }

  // Get user's API key
  const settingsResult = await query(
    'SELECT mistral_api_key FROM settings WHERE user_id = $1',
    [session.user.id]
  );
  const apiKey = settingsResult.rows[0]?.mistral_api_key || process.env.MISTRAL_API_KEY;

  if (!apiKey) {
    return res.status(400).json({ message: 'Kein Mistral API-Key konfiguriert' });
  }

  // Set status to analyzing
  await query(
    "UPDATE transcriptions SET status = 'analyzing', updated_at = NOW() WHERE id = $1",
    [id]
  );

  res.status(202).json({ message: 'Analyse gestartet', status: 'analyzing' });

  // Build text with speaker names if available
  try {
    let analysisText = job.text;
    const speakers = job.speakers || {};
    const segments = job.segments || [];

    if (segments.length > 0 && Object.keys(speakers).length > 0) {
      analysisText = buildTextWithSpeakers(segments, speakers);
    }

    // Update text with speaker names applied
    if (analysisText !== job.text) {
      await query(
        'UPDATE transcriptions SET text = $1, updated_at = NOW() WHERE id = $2',
        [analysisText, id]
      );
    }

    const analysis = await analyzeTranscription(analysisText, job.template, apiKey, job.custom_prompt || '');

    await query(
      "UPDATE transcriptions SET status = 'completed', analysis = $1, updated_at = NOW() WHERE id = $2",
      [JSON.stringify(analysis), id]
    );
  } catch (error) {
    console.error(`Analysis ${id} failed:`, error);
    await query(
      "UPDATE transcriptions SET status = 'error', error = $1, updated_at = NOW() WHERE id = $2",
      [error.message, id]
    );
  }
}
