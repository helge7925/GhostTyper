import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { getSettingsRow, resolveStoredApiKey } from '../../../lib/settings-service';
import { executeWorkflow } from '../../../lib/workflow-service';
import { MAX_TEXT_AI_INPUT_LENGTH } from '../../../lib/constants';
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
    keyPrefix: 'workflows-execute',
    identifier: `user:${session.user.id}`,
    limit: 40,
    windowMs: 60_000,
  });
  if (!allowed) return;

  const { workflowId, text, model } = req.body || {};
  if (!workflowId || typeof workflowId !== 'string') {
    return res.status(400).json({ message: 'Workflow-ID fehlt' });
  }
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ message: 'Text ist erforderlich' });
  }
  if (text.length > MAX_TEXT_AI_INPUT_LENGTH) {
    return res.status(400).json({ message: `Text ist zu lang (max. ${MAX_TEXT_AI_INPUT_LENGTH} Zeichen)` });
  }

  try {
    const settings = await getSettingsRow(session.user.id);
    const apiKey = resolveStoredApiKey(settings) || process.env.MISTRAL_API_KEY;

    if (!apiKey) {
      return res.status(400).json({ message: 'Kein Mistral API-Key konfiguriert' });
    }

    const result = await executeWorkflow({
      workflowId,
      inputText: text,
      apiKey,
      model,
      userId: session.user.id,
    });

    return res.status(200).json(result);
  } catch (error) {
    if (error?.code === '42P01' || error?.code === '42703') {
      return res.status(500).json({ message: 'Datenbank-Schema ist veraltet. Bitte /api/db-init ausführen.' });
    }
    if (error?.code === 'COST_LIMIT_EXCEEDED' || error?.code === 'BUDGET_GUARDRAIL_EXCEEDED') {
      return res.status(429).json({ message: error.message });
    }
    if (error?.code === 'COST_CHECK_UNAVAILABLE') {
      return res.status(503).json({ message: error.message });
    }
    if (error?.message === 'WORKFLOW_NOT_FOUND') {
      return res.status(404).json({ message: 'Workflow nicht gefunden' });
    }

    logApiError('Workflow execution error', error);
    return serverError(res, 'Workflow konnte nicht ausgeführt werden');
  }
}
