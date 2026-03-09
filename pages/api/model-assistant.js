import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';
import { getSettingsRow } from '../../lib/settings-service';
import { checkCostLimit, CostLimitCheckUnavailableError } from '../../lib/usage';
import { recommendModelPlan } from '../../lib/model-assistant';
import { enforceRateLimit, logApiError, serverError } from '../../lib/api-utils';

const ALLOWED_TASK_TYPES = new Set([
  'text-ai',
  'translation',
  'workflow',
  'transcription-analysis',
]);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'model-assistant',
    identifier: `user:${session.user.id}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!allowed) return;

  try {
    const {
      taskType,
      goal,
      inputText,
      fileSizeBytes,
      workflowSteps,
      includePostAnalysis,
    } = req.body || {};

    if (!ALLOWED_TASK_TYPES.has(taskType)) {
      return res.status(400).json({ message: 'Ungültiger Task-Typ' });
    }

    const settings = await getSettingsRow(session.user.id);
    const cost = await checkCostLimit(session.user.id);

    const recommendation = recommendModelPlan({
      taskType,
      goal,
      inputText,
      fileSizeBytes,
      workflowSteps,
      includePostAnalysis: includePostAnalysis === true,
      preferredModel: settings?.preferred_model || null,
      currentCost: cost.currentCost,
      costLimit: cost.limit,
    });

    return res.status(200).json(recommendation);
  } catch (error) {
    if (error instanceof CostLimitCheckUnavailableError || error?.code === 'COST_CHECK_UNAVAILABLE') {
      return res.status(503).json({ message: error.message });
    }
    logApiError('Model assistant error', error);
    return serverError(res, 'Modellempfehlung fehlgeschlagen');
  }
}
