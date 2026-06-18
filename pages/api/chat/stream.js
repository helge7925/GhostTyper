import { withOrgScope } from '../../../lib/api/with-org-scope';
import { enforceRateLimit, logApiError, serverError, fetchWithTimeout } from '../../../lib/api-utils';
import { resolveCortecsConfig } from '../../../lib/settings-service';
import { hasPermission } from '../../../lib/permissions';
import {
  CostLimitCheckUnavailableError,
  CostLimitExceededError,
  checkCostLimit,
  estimateCost,
  logUsage,
  withUserCostLock,
} from '../../../lib/usage';
import {
  CHAT_TIMEOUT_MS,
  buildConversationMessages,
  buildCortecsBody,
  getConversation,
  parseChatStreamLine,
  storeMessage,
  trimConversation,
  updateConversationMeta,
} from '../../../lib/chat-service';

function writeSseEvent(res, eventName, payload) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function startSse(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
}

/**
 * Streaming chat endpoint (Server-Sent Events). Mirrors the non-streaming
 * POST /api/chat turn — same retrieval, context, cost-lock, usage logging
 * and citation metadata — but forwards Cortecs tokens to the client as they
 * arrive. The client falls back to POST /api/chat if this fails.
 *
 * Events: `delta` { content }, `done` { message }, `error` { message, code }.
 */
async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }

  const userId = req.userId;
  const orgId = req.org.id;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'chat-message',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!allowed) return;

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

  let sseStarted = false;
  try {
    const conv = await getConversation(convId, orgId, userId);
    if (!conv) return res.status(404).json({ message: 'Chat nicht gefunden' });

    const cortecs = await resolveCortecsConfig({ userId, organizationId: orgId });
    if (!cortecs.apiKey) {
      return res.status(400).json({ message: 'Kein Cortecs API-Key konfiguriert' });
    }

    await storeMessage(convId, 'user', userMessage);

    const stored = await withUserCostLock(userId, async () => {
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
      const body = buildCortecsBody(cortecs, apiMessages, { stream: true });

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

      if (!response.ok || !response.body) {
        const errorText = response.ok ? 'Kein Stream-Body' : await response.text();
        throw new Error(`Cortecs API error: ${response.status} - ${String(errorText).slice(0, 300)}`);
      }

      // From here on we commit to SSE: headers are sent and the client
      // starts receiving tokens. Any later failure is reported as an
      // `error` SSE event rather than an HTTP status.
      startSse(res);
      sseStarted = true;

      let fullContent = '';
      let usage = null;
      const usedModel = cortecs.chatModel;
      let buffer = '';

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          const parsed = parseChatStreamLine(line);
          if (!parsed || parsed.done) continue;
          if (parsed.usage) usage = parsed.usage;
          if (parsed.contentDelta) {
            fullContent += parsed.contentDelta;
            writeSseEvent(res, 'delta', { content: parsed.contentDelta });
          }
        }
      }

      const promptTokens = usage?.prompt_tokens || 0;
      const completionTokens = usage?.completion_tokens || 0;
      const savedMessage = await storeMessage(convId, 'assistant', fullContent, {
        model: usedModel,
        inputTokens: promptTokens,
        outputTokens: completionTokens,
        cost: estimateCost(usedModel, promptTokens, completionTokens),
        metadata: { retrieval_results: retrieval.sources },
      });

      if (promptTokens || completionTokens) {
        await logUsage(userId, usedModel, 'chat_message', usage, orgId);
      }

      return savedMessage;
    });

    await trimConversation(convId);
    await updateConversationMeta(convId);

    writeSseEvent(res, 'done', { message: stored });
    res.end();
  } catch (error) {
    if (!sseStarted) {
      if (error?.code === 'COST_LIMIT_EXCEEDED' || error?.code === 'BUDGET_GUARDRAIL_EXCEEDED') {
        return res.status(429).json({ message: error.message });
      }
      if (error instanceof CostLimitCheckUnavailableError || error?.code === 'COST_CHECK_UNAVAILABLE') {
        return res.status(503).json({ message: error.message });
      }
      logApiError('Chat stream failed', error);
      return serverError(res, 'Chat-Nachricht konnte nicht verarbeitet werden.');
    }
    logApiError('Chat stream failed mid-stream', error);
    writeSseEvent(res, 'error', { message: 'Antwort konnte nicht vollständig erzeugt werden.' });
    res.end();
  }
}

export default withOrgScope({ permission: 'chat.read' }, handler);
