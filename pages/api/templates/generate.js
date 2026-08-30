import { generateTemplate } from '../../../lib/ai-service';
import { generateTemplateEdenAi } from '../../../lib/edenai-service';
import { resolveActiveProviderConfig } from '../../../lib/ai-provider-router';
import { withOrgScope } from '../../../lib/api/with-org-scope';
import { composeAbortSignals, executeReservedSpend, estimateTextUsage, requestBudgetScope } from '../../../lib/budget-runtime';
import { getSettingsRow } from '../../../lib/settings-service';
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
    const active = await resolveActiveProviderConfig({ userId, organizationId: orgId, capability: 'chat' });

    let providerModel;
    let callProvider;

    if (active.provider === 'edenai') {
      if (!active.apiKey) {
        return res.status(400).json({ message: 'Kein EdenAI-API-Key konfiguriert.' });
      }
      providerModel = active.model;
      callProvider = (_reservation, budgetSignal) => generateTemplateEdenAi(
        goal, active.apiKey, active.model, { signal: composeAbortSignals(budgetSignal) },
      );
    } else {
      const preferredModel = resolveConfiguredModel(active, 'chat', settingsRow?.preferred_model);
      if (!active.apiKey) {
        return res.status(400).json({ message: 'Kein OpenRouter-API-Key konfiguriert.' });
      }
      providerModel = preferredModel;
      callProvider = (_reservation, budgetSignal) => generateTemplate(
        goal,
        active.apiKey,
        preferredModel,
        {
          baseUrl: active.baseUrl,
          fallbackModel: active.defaultModels.chat,
          organizationId: active.organizationId,
          signal: composeAbortSignals(budgetSignal),
        },
      );
    }

    const { promptText } = await executeReservedSpend(
      {
        idempotencyKey: requestBudgetScope(req, 'template-generation', { goal, providerModel }),
        organizationId: orgId,
        userId,
        operation: 'template_generation',
        provider: active.provider,
        model: providerModel,
        estimatedUsage: estimateTextUsage(goal, {
          inputBufferTokens: 900,
          outputMultiplier: 3,
          outputBufferTokens: 1200,
        }),
      },
      callProvider,
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
