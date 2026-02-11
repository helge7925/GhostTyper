import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../auth/[...nextauth]';
import { query, resolveTemplate } from '../../../../lib/db';
import { analyzeTranscription, buildTextWithSpeakers } from '../../../../lib/ai-service';
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

  const result = await query(
    'SELECT id, text, segments, speakers, template, model, custom_prompt, status FROM transcriptions WHERE id = $1 AND user_id = $2',
    [id, session.user.id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ message: 'Transkription nicht gefunden' });
  }

  const job = result.rows[0];

  if (job.status !== 'transcribed') {
    return res.status(400).json({ message: `Analyse kann nur im Status "transcribed" gestartet werden (aktuell: "${job.status}")` });
  }

  // Get user's API key + settings
  const settingsResult = await query(
    'SELECT mistral_api_key, preferred_model, language FROM settings WHERE user_id = $1',
    [session.user.id]
  );
  const apiKey = settingsResult.rows[0]?.mistral_api_key || process.env.MISTRAL_API_KEY;
  const preferredModelFallback = settingsResult.rows[0]?.preferred_model || 'mistral-large-latest';
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

    const resolvedTemplate = await resolveTemplate(job.template, session.user.id);
    const { analysis, usage: analysisUsage, model: analysisModel } = await analyzeTranscription(
      analysisText, 
      resolvedTemplate, 
      apiKey, 
      job.custom_prompt || '', 
      job.model || preferredModelFallback, 
      language
    );

    // Log analysis usage
    await logUsage(session.user.id, analysisModel, 'analysis', analysisUsage);

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