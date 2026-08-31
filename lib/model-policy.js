import { normalizeModelId } from './openrouter.js';

// Syntax validation is deliberately provider-agnostic. Organization
// allowlists are enforced by the OpenRouter configuration at call sites.
export function isAllowedChatModel(model) {
  return Boolean(normalizeModelId(model));
}

export function isAllowedOcrModel(model) {
  return Boolean(normalizeModelId(model));
}

export function isAllowedTranscriptionModel(model) {
  return Boolean(normalizeModelId(model));
}

export function resolveChatModel(model, fallback = null) {
  if (!model) return fallback;
  return isAllowedChatModel(model) ? normalizeModelId(model) : null;
}

export function resolveTranscriptionModel(model, fallback = null) {
  if (!model) return fallback;
  return isAllowedTranscriptionModel(model) ? normalizeModelId(model) : null;
}

export function resolveOcrModel(model, fallback = null) {
  if (!model) return fallback;
  return isAllowedOcrModel(model) ? normalizeModelId(model) : null;
}
