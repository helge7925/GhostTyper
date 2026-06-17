import { query } from './db';
import { retrieveConversationSources } from './document-index';
import { buildCortecsBody, parseChatStreamLine } from './chat-stream-utils';

export { buildCortecsBody, parseChatStreamLine };

export const MAX_MESSAGES = 20;
export const CHAT_TIMEOUT_MS = Number.parseInt(process.env.CHAT_HTTP_TIMEOUT_MS, 10) || 120_000;

export async function getConversation(conversationId, orgId, userId) {
  const result = await query(
    `SELECT id, title, context_source, context_ref_id, context_snapshot, message_count
       FROM chat_conversations
      WHERE id = $1 AND organization_id = $2 AND user_id = $3`,
    [conversationId, orgId, userId],
  );
  return result.rows[0] || null;
}

export async function getRecentMessages(conversationId, limit = MAX_MESSAGES) {
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

export async function storeMessage(conversationId, role, content, meta = {}) {
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

export async function trimConversation(conversationId) {
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

export async function updateConversationMeta(conversationId) {
  const count = await query(
    'SELECT COUNT(*)::int AS cnt FROM chat_messages WHERE conversation_id = $1',
    [conversationId],
  );
  await query(
    'UPDATE chat_conversations SET message_count = $2, updated_at = NOW() WHERE id = $1',
    [conversationId, count.rows[0].cnt],
  );
}

export function buildSystemPrompt(contextSnapshot, contextSource, retrievalPrompt = '') {
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

/**
 * Run retrieval and assemble the chat-completion message list (system prompt
 * + recent history) for a conversation turn. Shared by the streaming and
 * non-streaming endpoints so both produce identical context + citations.
 */
export async function buildConversationMessages({ conversation, convId, userMessage, orgId, userId, cortecs }) {
  const recentMessages = await getRecentMessages(convId, MAX_MESSAGES - 1);
  const retrieval = await retrieveConversationSources({
    conversation,
    message: userMessage,
    organizationId: orgId,
    userId,
    cortecs,
  });
  const systemPrompt = buildSystemPrompt(conversation.context_snapshot, conversation.context_source, retrieval.prompt);

  const apiMessages = [];
  if (systemPrompt) apiMessages.push({ role: 'system', content: systemPrompt });
  for (const msg of recentMessages) {
    apiMessages.push({ role: msg.role, content: msg.content });
  }
  return { apiMessages, retrieval };
}
