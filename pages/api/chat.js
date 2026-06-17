import { query } from '../../lib/db';
import { withOrgScope } from '../../lib/api/with-org-scope';
import { enforceRateLimit, logApiError, serverError, fetchWithTimeout } from '../../lib/api-utils';
import { resolveCortecsConfig } from '../../lib/settings-service';
import { retrieveConversationSources } from '../../lib/document-index';
import { hasPermission } from '../../lib/permissions';
import { logUsage, estimateCost } from '../../lib/usage';
import {
  CostLimitCheckUnavailableError,
  CostLimitExceededError,
  checkCostLimit,
  withUserCostLock,
} from '../../lib/usage';

const MAX_MESSAGES = 20;
const CHAT_TIMEOUT_MS = Number.parseInt(process.env.CHAT_HTTP_TIMEOUT_MS, 10) || 120_000;

async function getConversation(conversationId, orgId, userId) {
  const result = await query(
    `SELECT id, title, context_source, context_ref_id, context_snapshot, message_count
       FROM chat_conversations
      WHERE id = $1 AND organization_id = $2 AND user_id = $3`,
    [conversationId, orgId, userId],
  );
  return result.rows[0] || null;
}

async function getRecentMessages(conversationId, limit = MAX_MESSAGES) {
  const result = await query(
    `SELECT id, role, content, model, metadata, created_at
       FROM chat_messages
      WHERE conversation_id = $1
      ORDER BY created_at ASC
      LIMIT $2`,
    [conversationId, limit],
  );
  return result.rows;
}

async function storeMessage(conversationId, role, content, meta = {}) {
  const result = await query(
    `INSERT INTO chat_messages (conversation_id, role, content, model, input_tokens, output_tokens, estimated_cost, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, role, content, model, metadata, created_at`,
    [
      conversationId,
      role,
      content,
      meta.model || null,
      meta.inputTokens || 0,
      meta.outputTokens || 0,
      meta.cost || 0,
      JSON.stringify(meta.metadata || {}),
    ],
  );
  return result.rows[0];
}

async function trimConversation(conversationId) {
  await query(
    `DELETE FROM chat_messages
      WHERE conversation_id = $1
        AND id NOT IN (
          SELECT id FROM chat_messages
           WHERE conversation_id = $1
           ORDER BY created_at DESC
           LIMIT $2
        )`,
    [conversationId, MAX_MESSAGES],
  );
}

async function updateConversationMeta(conversationId) {
  const count = await query(
    'SELECT COUNT(*)::int AS cnt FROM chat_messages WHERE conversation_id = $1',
    [conversationId],
  );
  await query(
    'UPDATE chat_conversations SET message_count = $2, updated_at = NOW() WHERE id = $1',
    [conversationId, count.rows[0].cnt],
  );
}

function buildSystemPrompt(contextSnapshot, contextSource, retrievalPrompt = '') {
  if (!contextSnapshot && !retrievalPrompt) return null;
  const retrievalBlock = retrievalPrompt ? `\n\nZusaetzlich wurden passende Quellen aus dem Dateien-Index gefunden:\n\n${retrievalPrompt}` : '';
  if (!contextSnapshot) {
    return `Du bist ein hilfreicher KI-Assistent.${retrievalBlock}`;
  }
  try {
    const ctx = JSON.parse(contextSnapshot);
    const sourceLabel = contextSource === 'ocr' ? 'OCR-Ergebnis' :
      contextSource === 'translate' ? 'Übersetzung' :
      contextSource === 'textoptimization' ? 'optimierten Text' :
      'Transkription';
    return `Du bist ein hilfreicher KI-Assistent. Der Nutzer hat folgenden ${sourceLabel} mitgebracht, auf den sich seine Fragen beziehen können:\n\n---\n${ctx.text || ''}\n---${retrievalBlock}\n\nBeantworte die Fragen des Nutzers basierend auf diesem Kontext. Wenn eine Frage nichts mit dem bereitgestellten Kontext zu tun hat, kannst du trotzdem antworten, aber weise darauf hin, dass die Antwort nicht auf dem geteilten Dokument basiert.`;
  } catch {
    return retrievalPrompt ? `Du bist ein hilfreicher KI-Assistent.${retrievalBlock}` : null;
  }
}

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

        const recentMessages = await getRecentMessages(convId, MAX_MESSAGES - 1);
        const retrieval = await retrieveConversationSources({
          conversation: conv,
          message: userMessage,
          organizationId: orgId,
          userId,
          cortecs,
        });
        const systemPrompt = buildSystemPrompt(conv.context_snapshot, conv.context_source, retrieval.prompt);
        const apiMessages = [];

        if (systemPrompt) {
          apiMessages.push({ role: 'system', content: systemPrompt });
        }
        for (const msg of recentMessages) {
          apiMessages.push({ role: msg.role, content: msg.content });
        }

        const body = {
          model: cortecs.chatModel,
          messages: apiMessages,
          temperature: 0.7,
        };
        if (cortecs.preference) body.preference = cortecs.preference;

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
          throw new Error(`Cortecs API error: ${response.status} - ${errorText.slice(0, 300)}`);
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
      logApiError('Chat POST failed', error);
      return serverError(res, 'Chat-Nachricht konnte nicht verarbeitet werden.');
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
}

export default withOrgScope({ permission: 'chat.read' }, handler);
