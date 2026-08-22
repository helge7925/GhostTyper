import { generateTemplate } from '../../../lib/ai-service';
import { withOrgScope } from '../../../lib/api/with-org-scope';
import { composeAbortSignals, executeReservedSpend, estimateTextUsage, requestBudgetScope } from '../../../lib/budget-runtime';
import { getSettingsRow, resolveOpenRouterConfig } from '../../../lib/settings-service';
import { resolveConfiguredModel } from '../../../lib/openrouter';
import { MAX_TEMPLATE_GENERATOR_GOAL_LENGTH } from '../../../lib/constants';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { hasPermission } from '../../../lib/permissions';

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const userId = req.userId;
  const orgId = req.org.id;
  if (!hasPermission(req.role, 'paid.execute')) {
    return res.status(403).json({ code: 'FORBIDDEN' });
  }

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'template-generate',
    identifier: `org:${orgId}:user:${userId}`,
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
    const settingsRow = await getSettingsRow(userId);
    const openrouter = await resolveOpenRouterConfig({ userId, organizationId: req.org?.id });
    const preferredModel = resolveConfiguredModel(openrouter, 'chat', settingsRow?.preferred_model);

    if (!openrouter.apiKey) {
      return res.status(400).json({ message: 'Kein OpenRouter-API-Key konfiguriert.' });
    }

    const { promptText } = await executeReservedSpend(
      {
        idempotencyKey: requestBudgetScope(req, 'template-generation', { goal, preferredModel }),
        organizationId: orgId,
        userId,
        operation: 'template_generation',
        provider: 'openrouter',
        model: preferredModel,
        estimatedUsage: estimateTextUsage(goal, {
          inputBufferTokens: 900,
          outputMultiplier: 3,
          outputBufferTokens: 1200,
        }),
      },
      (_reservation, budgetSignal) => generateTemplate(
        goal,
        openrouter.apiKey,
        preferredModel,
        { baseUrl: openrouter.baseUrl, fallbackModel: openrouter.defaultModels.chat, signal: composeAbortSignals(budgetSignal) },
      ),
    );

    return res.status(200).json({ promptText });
  } catch (error) {
    if (error?.code === 'BUDGET_EXCEEDED') {
      return res.status(429).json({ message: error.message });
    }
    if (error?.code === 'BUDGET_ACCOUNTING_UNAVAILABLE' || error?.code === 'PRICING_CONFIGURATION_MISSING') {
      return res.status(503).json({ message: error.message });
    }
    logApiError('Error generating template', error);
    return serverError(res, 'Fehler bei der Generierung der Vorlage');
  }
}

export default withOrgScope({ permission: 'template.write' }, handler);
