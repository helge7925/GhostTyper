import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { generateTemplate } from '../../../lib/ai-service';
import { logUsage, checkCostLimit } from '../../../lib/usage';
import { getSettingsRow, resolveStoredApiKey } from '../../../lib/settings-service';
import { checkRateLimit, applyRateLimitHeaders } from '../../../lib/rate-limit';
import { logApiError, serverError } from '../../../lib/api-utils';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const rate = checkRateLimit(req, {
    keyPrefix: 'template-generate',
    identifier: `user:${session.user.id}`,
    limit: 20,
    windowMs: 60_000,
  });
  applyRateLimitHeaders(res, rate);
  if (!rate.allowed) {
    return res.status(429).json({ message: 'Zu viele Anfragen. Bitte später erneut versuchen.' });
  }

  const { goal } = req.body;
  if (!goal) {
    return res.status(400).json({ message: 'Ziel ist erforderlich' });
  }

  try {
    const settingsRow = await getSettingsRow(session.user.id);
    const apiKey = resolveStoredApiKey(settingsRow) || process.env.MISTRAL_API_KEY;

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
    logApiError('Error generating template', error);
    return serverError(res, 'Fehler bei der Generierung der Vorlage');
  }
}
