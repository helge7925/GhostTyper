import { query } from './db';
import { retrieveConversationSources } from './document-index';
import { buildCortecsBody, parseChatStreamLine } from './chat-stream-utils';
import { fetchWithTimeout } from './api-utils';

export { buildCortecsBody, parseChatStreamLine };

export const MAX_MESSAGES = 20;
export const CHAT_TIMEOUT_MS = Number.parseInt(process.env.CHAT_HTTP_TIMEOUT_MS, 10) || 120_000;

export class CortecsApiError extends Error {
  constructor(status, detail = '') {
    super(`Cortecs API error: ${status} - ${String(detail).slice(0, 300)}`);
    this.name = 'CortecsApiError';
    this.code = 'CORTECS_API_ERROR';
    this.status = status;
    this.detail = detail;
  }
}

export function cortecsErrorResponse(error) {
  if (error?.code !== 'CORTECS_API_ERROR') return null;
  if (error.status === 401 || error.status === 403) {
    return {
      status: 400,
      message: 'Cortecs API-Key wurde abgelehnt. Bitte den Key in den Workspace-Einstellungen unter Integrationen prüfen.',
    };
  }
  if (error.status === 429) {
    return { status: 429, message: 'Cortecs Rate-Limit erreicht. Bitte später erneut versuchen.' };
  }
  if (error.status >= 500) {
    return { status: 502, message: 'Cortecs ist aktuell nicht erreichbar. Bitte später erneut versuchen.' };
  }
  return { status: 502, message: 'Cortecs-Anfrage konnte nicht verarbeitet werden. Bitte Workspace-Integration prüfen.' };
}

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

export async function getMessageForUser(messageId, orgId, userId) {
  const result = await query(
    `SELECT m.id, m.conversation_id, m.role, m.content, m.created_at,
            c.id AS conversation_id, c.title, c.context_source, c.context_ref_id, c.context_snapshot, c.message_count
       FROM chat_messages m
       JOIN chat_conversations c ON c.id = m.conversation_id
      WHERE m.id = $1 AND c.organization_id = $2 AND c.user_id = $3`,
    [messageId, orgId, userId],
  );
  return result.rows[0] || null;
}

export async function findPreviousUserMessage(conversationId, beforeMessageId) {
  const result = await query(
    `SELECT id, content
       FROM chat_messages
      WHERE conversation_id = $1 AND id < $2 AND role = 'user'
      ORDER BY id DESC
      LIMIT 1`,
    [conversationId, beforeMessageId],
  );
  return result.rows[0] || null;
}

export async function updateUserMessageAndDeleteFollowing({ messageId, conversationId, content }) {
  await query(
    `UPDATE chat_messages SET content = $1, metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb WHERE id = $3 AND conversation_id = $4 AND role = 'user'`,
    [content, JSON.stringify({ edited_at: new Date().toISOString() }), messageId, conversationId],
  );
  await query('DELETE FROM chat_messages WHERE conversation_id = $1 AND id > $2', [conversationId, messageId]);
}

export async function deleteMessage(messageId, conversationId) {
  await query('DELETE FROM chat_messages WHERE id = $1 AND conversation_id = $2', [messageId, conversationId]);
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

// Hard-coded identity and behaviour for the chat assistant. This is
// intentionally not user-configurable and is always prepended to every
// conversation's system prompt, regardless of context or retrieval.
export const BASE_SYSTEM_PROMPT =
  'Du bist der KI-Assistent von GhostTyper, erschaffen von Helge Roos. '
  + 'Antworte stets kurz und knapp, präzise und ohne unnötige Floskeln oder Wiederholungen. '
  + 'Wenn du gefragt wirst, wer dich erstellt, entwickelt oder erschaffen hat bzw. woher du stammst, '
  + 'antworte, dass du von Helge Roos erschaffen wurdest.';

// Titles we consider "auto-assigned" and therefore safe to overwrite with an
// AI-generated one. A title the user typed (or anything else) is left alone.
const AUTO_TITLES = new Set(['Neuer Chat', 'New chat', 'Chat zu Transkription']);

function sanitizeTitle(raw) {
  let title = String(raw || '').trim();
  // Strip surrounding quotes, leading list markers and a trailing period.
  title = title.replace(/^["'„“»]+|["'„“«»]+$/g, '').trim();
  title = title.replace(/^[-*\d.)\s]+/, '').trim();
  title = title.replace(/[.\s]+$/, '').trim();
  // Collapse whitespace/newlines into single spaces.
  title = title.replace(/\s+/g, ' ');
  return title.slice(0, 80);
}

/**
 * Generate a short, content-aware title for a conversation after its first
 * exchange and persist it — but only while the title is still an auto-assigned
 * default. Best-effort: any failure is swallowed so it never breaks the chat.
 */
export async function maybeGenerateConversationTitle({ convId, cortecs, userMessage, assistantMessage }) {
  try {
    if (!cortecs?.apiKey) return null;
    const row = await query(
      'SELECT title FROM chat_conversations WHERE id = $1',
      [convId],
    );
    const current = row.rows[0]?.title;
    if (current == null || !AUTO_TITLES.has(current)) return null;

    const messages = [
      {
        role: 'system',
        content: 'Du erzeugst einen sehr kurzen, prägnanten Titel (3–6 Wörter) für einen Chat, '
          + 'der dessen Thema und Kontext zusammenfasst. Verwende die Sprache des Gesprächs. '
          + 'Gib ausschließlich den Titel zurück – ohne Anführungszeichen, ohne Punkt am Ende, ohne Präfix wie "Titel:".',
      },
      {
        role: 'user',
        content: `Nachricht des Nutzers:\n${String(userMessage || '').slice(0, 2000)}`
          + `\n\nAntwort des Assistenten:\n${String(assistantMessage || '').slice(0, 2000)}`
          + '\n\nTitel:',
      },
    ];
    const body = buildCortecsBody(cortecs, messages, { stream: false });
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
    if (!response.ok) return null;
    const data = await response.json();
    const title = sanitizeTitle(data?.choices?.[0]?.message?.content);
    if (!title) return null;

    // Guard against a concurrent rename: only overwrite if still an auto title.
    const updated = await query(
      `UPDATE chat_conversations SET title = $2, updated_at = NOW()
       WHERE id = $1 AND title = ANY($3) RETURNING title`,
      [convId, title, Array.from(AUTO_TITLES)],
    );
    return updated.rows[0]?.title || null;
  } catch {
    return null;
  }
}

export function buildSystemPrompt(contextSnapshot, contextSource, retrievalPrompt = '') {
  const retrievalBlock = retrievalPrompt ? `\n\nZusaetzlich wurden passende Quellen aus dem Dateien-Index gefunden:\n\n${retrievalPrompt}` : '';
  let contextBlock = '';
  if (contextSnapshot) {
    try {
      const ctx = JSON.parse(contextSnapshot);
      const sourceLabel = contextSource === 'ocr' ? 'OCR-Ergebnis' :
        contextSource === 'translate' ? 'Übersetzung' :
        contextSource === 'textoptimization' ? 'optimierten Text' :
        'Transkription';
      contextBlock = `\n\nDer Nutzer hat folgenden ${sourceLabel} mitgebracht, auf den sich seine Fragen beziehen können:\n\n---\n${ctx.text || ''}\n---\n\nBeantworte die Fragen des Nutzers basierend auf diesem Kontext. Wenn eine Frage nichts mit dem bereitgestellten Kontext zu tun hat, kannst du trotzdem antworten, aber weise darauf hin, dass die Antwort nicht auf dem geteilten Dokument basiert.`;
    } catch {
      // Malformed snapshot — fall back to the base prompt (+ retrieval) only.
    }
  }
  return `${BASE_SYSTEM_PROMPT}${contextBlock}${retrievalBlock}`;
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
