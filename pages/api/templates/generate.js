import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { generateTemplate } from '../../../lib/ai-service';
import {
  CostLimitCheckUnavailableError,
  CostLimitExceededError,
  logUsage,
  checkCostLimit,
  withUserCostLock,
} from '../../../lib/usage';
import { getSettingsRow, resolveStoredApiKey } from '../../../lib/settings-service';
import { MAX_TEMPLATE_GENERATOR_GOAL_LENGTH } from '../../../lib/constants';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'template-generate',
    identifier: `user:${session.user.id}`,
    limit: 20,
    windowMs: 60_000,
  });
  if (!allowed) return;

  const { goal } = req.body;
  if (!goal || typeof goal !== 'string') {
    return res.status(400).json({ message: 'Ziel ist erforderlich' });
  }
  if (goal.length > MAX_TEMPLATE_GENERATOR_GOAL_LENGTH) {
    return res.status(400).json({ message: `Ziel ist zu lang (max. ${MAX_TEMPLATE_GENERATOR_GOAL_LENGTH} Zeichen)` });
  }

  try {
    const settingsRow = await getSettingsRow(session.user.id);
    const apiKey = resolveStoredApiKey(settingsRow) || process.env.MISTRAL_API_KEY;

    if (!apiKey) {
      return res.status(400).json({ message: 'Kein Mistral API-Key konfiguriert.' });
    }

    const promptText = await withUserCostLock(session.user.id, async () => {
      const costCheck = await checkCostLimit(session.user.id);
      if (!costCheck.allowed) {
        throw new CostLimitExceededError(costCheck.currentCost, costCheck.limit);
      }

      const { promptText: value, usage, model } = await generateTemplate(goal, apiKey);
      await logUsage(session.user.id, model, 'template_generation', usage);
      return value;
    });

    return res.status(200).json({ promptText });
  } catch (error) {
    if (error?.code === 'COST_LIMIT_EXCEEDED') {
      return res.status(429).json({ message: error.message });
    }
    if (error instanceof CostLimitCheckUnavailableError || error?.code === 'COST_CHECK_UNAVAILABLE') {
      return res.status(503).json({ message: error.message });
    }
    logApiError('Error generating template', error);
    return serverError(res, 'Fehler bei der Generierung der Vorlage');
  }
}
