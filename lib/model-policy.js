import {
  CHAT_MODELS,
  OCR_MODELS,
  DEFAULT_CHAT_MODEL,
  DEFAULT_OCR_MODEL,
  DEFAULT_TEXT_AI_MODEL,
} from './constants';

export function isAllowedChatModel(model) {
  return CHAT_MODELS.includes(model);
}

export function isAllowedOcrModel(model) {
  return OCR_MODELS.includes(model);
}

export function resolveChatModel(model, fallback = DEFAULT_CHAT_MODEL) {
  if (!model) return fallback;
  return isAllowedChatModel(model) ? model : null;
}

export function resolveTextAiModel(model) {
  if (!model) return DEFAULT_TEXT_AI_MODEL;
  return isAllowedChatModel(model) ? model : null;
}

export function resolveOcrModel(model) {
  if (!model) return DEFAULT_OCR_MODEL;
  return isAllowedOcrModel(model) ? model : null;
}

