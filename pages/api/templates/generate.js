import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { query } from '../../../lib/db';
import { generateTemplate } from '../../../lib/ai-service';
import { logUsage, checkCostLimit } from '../../../lib/usage';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const { goal } = req.body;
  if (!goal) {
    return res.status(400).json({ message: 'Ziel ist erforderlich' });
  }

  try {
    // Get user's API key
    const settingsResult = await query(
      'SELECT mistral_api_key FROM settings WHERE user_id = $1',
      [session.user.id]
    );
    const apiKey = settingsResult.rows[0]?.mistral_api_key || process.env.MISTRAL_API_KEY;

    if (!apiKey) {
      return res.status(400).json({ message: 'Kein Mistral API-Key konfiguriert.' });
    }

    // Check cost limit
    const costCheck = await checkCostLimit(session.user.id);
    if (!costCheck.allowed) {
      return res.status(429).json({ message: 'Kostenlimit erreicht.' });
    }

    const { promptText, usage, model } = await generateTemplate(goal, apiKey);

    // Log usage
    await logUsage(session.user.id, model, 'template_generation', usage);

    return res.status(200).json({ promptText });
  } catch (error) {
    console.error('Error generating template:', error);
    return res.status(500).json({ message: 'Fehler bei der Generierung der Vorlage' });
  }
}
