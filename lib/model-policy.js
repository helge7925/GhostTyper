import {
  OCR_MODELS,
  DEFAULT_CHAT_MODEL,
  DEFAULT_OCR_MODEL,
  DEFAULT_TRANSCRIPTION_MODEL,
} from './constants.js';

const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const REMOVED_CHAT_MODELS = new Set([
  'mistral-large-latest',
  'mistral-medium-latest',
  'mistral-small-latest',
  // Typo-id shipped in early Cortecs builds — the API only knows
  // `kimi-k2.6`. Blocking it lets stored preferences fall back to a
  // working default instead of erroring on every request.
  'kimi-2.6',
]);

function normalizeModelId(model) {
  if (typeof model !== 'string') return null;
  const trimmed = model.trim();
  if (!trimmed || !MODEL_ID_PATTERN.test(trimmed)) return null;
  return trimmed;
}

// Chat/transcription policy is deliberately permissive: Cortecs routes to
// many upstream models, so any well-formed model id passes. The lists in
// constants.js are only the curated UI offering, not a hard allowlist —
// the sole hard block is the removed legacy Mistral chat ids above.
export function isAllowedChatModel(model) {
  if (REMOVED_CHAT_MODELS.has(model)) return false;
  return Boolean(normalizeModelId(model));
}

export function isAllowedOcrModel(model) {
  return OCR_MODELS.includes(model);
}

export function isAllowedTranscriptionModel(model) {
  return Boolean(normalizeModelId(model));
}

export function resolveChatModel(model, fallback = DEFAULT_CHAT_MODEL) {
  if (!model) return fallback;
  return isAllowedChatModel(model) ? normalizeModelId(model) : null;
}

export function resolveTranscriptionModel(model, fallback = DEFAULT_TRANSCRIPTION_MODEL) {
  if (!model) return fallback;
  return isAllowedTranscriptionModel(model) ? normalizeModelId(model) : null;
}

export function resolveOcrModel(model) {
  if (!model) return DEFAULT_OCR_MODEL;
  return isAllowedOcrModel(model) ? model : null;
}
