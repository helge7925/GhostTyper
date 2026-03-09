import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';
import { query } from '../../lib/db';
import {
  CostLimitCheckUnavailableError,
  CostLimitExceededError,
  enforceProjectedBudgetGuardrail,
  estimateTextTransformCost,
  logUsage,
  checkCostLimit,
  withUserCostLock,
} from '../../lib/usage';
import { resolveTextAiModel } from '../../lib/model-policy';
import { getSettingsRow, resolveStoredApiKey } from '../../lib/settings-service';
import { MAX_TEXT_AI_INPUT_LENGTH } from '../../lib/constants';
import { enforceRateLimit, fetchWithTimeout, logApiError, serverError } from '../../lib/api-utils';

const MISTRAL_API_URL = 'https://api.mistral.ai/v1';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'text-ai',
    identifier: `user:${session.user.id}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!allowed) return;

  const { text, action, model } = req.body;
  const selectedModel = resolveTextAiModel(model);
  const taskId = Number.parseInt(action, 10);

  if (!text || !action || typeof text !== 'string') {
    return res.status(400).json({ message: 'Text und Aktion sind erforderlich' });
  }
  if (text.length > MAX_TEXT_AI_INPUT_LENGTH) {
    return res.status(400).json({ message: `Text ist zu lang (max. ${MAX_TEXT_AI_INPUT_LENGTH} Zeichen)` });
  }
  if (!Number.isFinite(taskId)) {
    return res.status(400).json({ message: 'Ungültige Aktion' });
  }
  if (!selectedModel) {
    return res.status(400).json({ message: 'Ungültiges KI-Modell' });
  }

  try {
    // 1. Fetch prompt from DB (action is the ID of the text_task)
    const taskResult = await query(
      'SELECT prompt FROM text_tasks WHERE id = $1 AND user_id = $2',
      [taskId, session.user.id]
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

    const resultText = await withUserCostLock(session.user.id, async () => {
      const costCheck = await checkCostLimit(session.user.id);
      if (!costCheck.allowed) {
        throw new CostLimitExceededError(costCheck.currentCost, costCheck.limit);
      }
      const estimatedCost = estimateTextTransformCost(selectedModel, text, {
        inputBufferTokens: 110,
        outputMultiplier: 0.75,
        outputBufferTokens: 160,
      });
      await enforceProjectedBudgetGuardrail(session.user.id, estimatedCost);

      const response = await fetchWithTimeout(`${MISTRAL_API_URL}/chat/completions`, {
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
      await logUsage(session.user.id, selectedModel, 'text_ai', data.usage);
      return data.choices[0]?.message?.content || '';
    });

    return res.status(200).json({ resultText });
  } catch (error) {
    if (error?.code === 'COST_LIMIT_EXCEEDED' || error?.code === 'BUDGET_GUARDRAIL_EXCEEDED') {
      return res.status(429).json({ message: error.message });
    }
    if (error instanceof CostLimitCheckUnavailableError || error?.code === 'COST_CHECK_UNAVAILABLE') {
      return res.status(503).json({ message: error.message });
    }
    logApiError('Text AI error', error);
    return serverError(res, 'Fehler bei der Textverarbeitung');
  }
}
