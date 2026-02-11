import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';
import { query } from '../../lib/db';
import { logUsage, checkCostLimit } from '../../lib/usage';
import { resolveTextAiModel } from '../../lib/model-policy';
import { getSettingsRow, resolveStoredApiKey } from '../../lib/settings-service';
import { checkRateLimit, applyRateLimitHeaders } from '../../lib/rate-limit';
import { logApiError, serverError } from '../../lib/api-utils';

const MISTRAL_API_URL = 'https://api.mistral.ai/v1';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const rate = checkRateLimit(req, {
    keyPrefix: 'text-ai',
    identifier: `user:${session.user.id}`,
    limit: 60,
    windowMs: 60_000,
  });
  applyRateLimitHeaders(res, rate);
  if (!rate.allowed) {
    return res.status(429).json({ message: 'Zu viele Anfragen. Bitte später erneut versuchen.' });
  }

  const { text, action, model } = req.body;
  const selectedModel = resolveTextAiModel(model);

  if (!text || !action) {
    return res.status(400).json({ message: 'Text und Aktion sind erforderlich' });
  }
  if (!selectedModel) {
    return res.status(400).json({ message: 'Ungültiges KI-Modell' });
  }

  try {
    // 1. Fetch prompt from DB (action is the ID of the text_task)
    const taskResult = await query(
      'SELECT prompt FROM text_tasks WHERE id = $1 AND user_id = $2',
      [action, session.user.id]
    );

    if (taskResult.rows.length === 0) {
      return res.status(404).json({ message: 'Aufgabe nicht gefunden' });
    }

    const actionPrompt = taskResult.rows[0].prompt;

    const settingsRow = await getSettingsRow(session.user.id);
    const apiKey = resolveStoredApiKey(settingsRow) || process.env.MISTRAL_API_KEY;

    if (!apiKey) {
      return res.status(400).json({ message: 'Kein Mistral API-Key konfiguriert' });
    }

    const costCheck = await checkCostLimit(session.user.id);
    if (!costCheck.allowed) {
      return res.status(429).json({ message: 'Kostenlimit erreicht' });
    }

    const response = await fetch(`${MISTRAL_API_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: [
          { role: 'system', content: 'Du bist ein hilfreicher KI-Assistent für Textverarbeitung. Antworte präzise und gib nur das Ergebnis zurück, ohne Einleitung oder Kommentare. Kein Text um des Textes willen: keine Floskeln, keine Wiederholungen, kein unnötiger Zusatz.' },
          { role: 'user', content: `${actionPrompt}

Text:
${text}` }
        ],
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      throw new Error(`Mistral API error: ${response.status}`);
    }

    const data = await response.json();
    const resultText = data.choices[0]?.message?.content || '';

    await logUsage(session.user.id, selectedModel, 'text_ai', data.usage);

    return res.status(200).json({ resultText });
  } catch (error) {
    logApiError('Text AI error', error);
    return serverError(res, 'Fehler bei der Textverarbeitung');
  }
}
