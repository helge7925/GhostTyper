/**
 * Pure, dependency-free helpers for the chat-completion request/stream shape.
 * Kept import-free so they can be unit-tested without the DB/retrieval stack.
 */

/** Build the Cortecs (OpenAI-compatible) chat-completions request body. */
export function buildCortecsBody(cortecs, apiMessages, { stream = false } = {}) {
  const body = {
    model: cortecs.chatModel,
    messages: apiMessages,
    temperature: 0.7,
  };
  if (cortecs.preference) body.preference = cortecs.preference;
  if (stream) {
    body.stream = true;
    body.stream_options = { include_usage: true };
  }
  return body;
}

/**
 * Parse a single line from a Cortecs/OpenAI SSE chat-completion stream.
 *
 * Returns `null` for non-data lines (blank lines, comments, parse errors),
 * `{ done: true }` for the terminal `data: [DONE]` marker, or
 * `{ contentDelta, finishReason, usage }` for a data chunk.
 */
export function parseChatStreamLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed.startsWith('data:')) return null;
  const payload = trimmed.slice(5).trim();
  if (!payload) return null;
  if (payload === '[DONE]') return { done: true };
  let json;
  try {
    json = JSON.parse(payload);
  } catch {
    return null;
  }
  const choice = Array.isArray(json.choices) ? json.choices[0] : null;
  return {
    contentDelta: choice?.delta?.content || '',
    finishReason: choice?.finish_reason || null,
    usage: json.usage || null,
  };
}
