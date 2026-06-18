import { withOrgScope } from '../../lib/api/with-org-scope';
import { enforceRateLimit, logApiError, serverError, fetchWithTimeout } from '../../lib/api-utils';
import { resolveCortecsConfig } from '../../lib/settings-service';
import { hasPermission } from '../../lib/permissions';
import { logUsage, estimateCost } from '../../lib/usage';
import {
  CostLimitCheckUnavailableError,
  CostLimitExceededError,
  checkCostLimit,
  withUserCostLock,
} from '../../lib/usage';
import {
  CHAT_TIMEOUT_MS,
  CortecsApiError,
  buildConversationMessages,
  buildCortecsBody,
  cortecsErrorResponse,
  getConversation,
  getRecentMessages,
  storeMessage,
  trimConversation,
  updateConversationMeta,
} from '../../lib/chat-service';

async function handler(req, res) {
  const userId = req.userId;
  const orgId = req.org.id;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'chat-message',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!allowed) return;

  if (req.method === 'GET') {
    const conversationId = Number(req.query.conversationId);
    if (!Number.isFinite(conversationId)) {
      return res.status(400).json({ message: 'Ungültige Chat-ID' });
    }
    try {
      const conv = await getConversation(conversationId, orgId, userId);
      if (!conv) return res.status(404).json({ message: 'Chat nicht gefunden' });
      const messages = await getRecentMessages(conversationId);
      return res.status(200).json({ conversation: conv, messages });
    } catch (error) {
      logApiError('Chat GET failed', error);
      return serverError(res, 'Chat konnte nicht geladen werden.');
    }
  }

  if (req.method === 'POST') {
    if (!hasPermission(req.role, 'chat.write')) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Keine Berechtigung.' });
    }

    const { conversationId, message } = req.body && typeof req.body === 'object' ? req.body : {};
    const convId = Number(conversationId);
    const userMessage = String(message || '').trim();

    if (!Number.isFinite(convId) || !userMessage) {
      return res.status(400).json({ message: 'Chat-ID und Nachricht sind erforderlich' });
    }
    if (userMessage.length > 8000) {
      return res.status(400).json({ message: 'Nachricht ist zu lang (max. 8.000 Zeichen)' });
    }

    try {
      const conv = await getConversation(convId, orgId, userId);
      if (!conv) return res.status(404).json({ message: 'Chat nicht gefunden' });

      await storeMessage(convId, 'user', userMessage);

      const cortecs = await resolveCortecsConfig({ userId, organizationId: orgId });
      if (!cortecs.apiKey) {
        return res.status(400).json({ message: 'Kein Cortecs API-Key konfiguriert' });
      }

      const reply = await withUserCostLock(userId, async () => {
        const costCheck = await checkCostLimit(userId, orgId);
        if (!costCheck.allowed) {
          throw new CostLimitExceededError(costCheck.currentCost, costCheck.limit);
        }

        const { apiMessages, retrieval } = await buildConversationMessages({
          conversation: conv,
          convId,
          userMessage,
          orgId,
          userId,
          cortecs,
        });
        const body = buildCortecsBody(cortecs, apiMessages);

        const response = await fetchWithTimeout(
          `${cortecs.baseUrl}/chat/completions`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${cortecs.apiKey}`,
            },
            body: JSON.stringify(body),
          },
          CHAT_TIMEOUT_MS,
        );

        if (!response.ok) {
          const errorText = await response.text();
          throw new CortecsApiError(response.status, errorText);
        }

        const result = await response.json();
        const aiContent = result.choices?.[0]?.message?.content || '';
        const usage = result.usage || {};
        const usedModel = result.model || cortecs.chatModel;

        const stored = await storeMessage(convId, 'assistant', aiContent, {
          model: usedModel,
          inputTokens: usage.prompt_tokens || 0,
          outputTokens: usage.completion_tokens || 0,
          cost: estimateCost(usedModel, usage.prompt_tokens || 0, usage.completion_tokens || 0),
          metadata: {
            retrieval_results: retrieval.sources,
          },
        });

        if (usage.prompt_tokens || usage.completion_tokens) {
          await logUsage(userId, usedModel, 'chat_message', usage, orgId);
        }

        return { stored, usage, usedModel };
      });

      await trimConversation(convId);
      await updateConversationMeta(convId);

      return res.status(200).json({ message: reply.stored });
    } catch (error) {
      if (error?.code === 'COST_LIMIT_EXCEEDED' || error?.code === 'BUDGET_GUARDRAIL_EXCEEDED') {
        return res.status(429).json({ message: error.message });
      }
      if (error instanceof CostLimitCheckUnavailableError || error?.code === 'COST_CHECK_UNAVAILABLE') {
        return res.status(503).json({ message: error.message });
      }
      const cortecsError = cortecsErrorResponse(error);
      if (cortecsError) {
        logApiError('Chat POST Cortecs failed', error);
        return res.status(cortecsError.status).json({ message: cortecsError.message });
      }
      logApiError('Chat POST failed', error);
      return serverError(res, 'Chat-Nachricht konnte nicht verarbeitet werden.');
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
}

export default withOrgScope({ permission: 'chat.read' }, handler);
