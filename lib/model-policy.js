import {
  CHAT_MODELS,
  OCR_MODELS,
  TRANSCRIPTION_MODELS,
  DEFAULT_CHAT_MODEL,
  DEFAULT_OCR_MODEL,
  DEFAULT_TRANSCRIPTION_MODEL,
} from './constants';

const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

function normalizeModelId(model) {
  if (typeof model !== 'string') return null;
  const trimmed = model.trim();
  if (!trimmed || !MODEL_ID_PATTERN.test(trimmed)) return null;
  return trimmed;
}

export function isAllowedChatModel(model) {
  return CHAT_MODELS.includes(model) || Boolean(normalizeModelId(model));
}

export function isAllowedOcrModel(model) {
  return OCR_MODELS.includes(model);
}

export function isAllowedTranscriptionModel(model) {
  return TRANSCRIPTION_MODELS.includes(model) || Boolean(normalizeModelId(model));
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
