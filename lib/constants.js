export const ACCEPTED_AUDIO_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/ogg',
  'audio/webm',
  'video/webm',
  'audio/webm;codecs=opus',
  'video/webm;codecs=opus',
  'audio/flac',
  'audio/m4a',
  'audio/x-m4a',
  'audio/mp4',
  'audio/aac',
  'audio/x-aac',
];

export const ACCEPTED_OCR_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
];

export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
export const MAX_DOCUMENT_TITLE_LENGTH = 255;
export const MAX_DOCUMENT_TEXT_LENGTH = 300_000;
export const MAX_DOCUMENT_HTML_LENGTH = 700_000;
export const MAX_TEXT_AI_INPUT_LENGTH = 120_000;
export const MAX_TRANSLATE_INPUT_LENGTH = 120_000;
export const MAX_TEMPLATE_GENERATOR_GOAL_LENGTH = 4_000;
export const MAX_TEMPLATE_NAME_LENGTH = 100;
export const MAX_FOLDER_NAME_LENGTH = 100;
export const MAX_TEXT_TASK_NAME_LENGTH = 100;
export const MAX_TEXT_TASK_PROMPT_LENGTH = 20_000;
export const MAX_CUSTOM_PROMPT_LENGTH = 8_000;
export const MAX_REALTIME_AUDIO_CHUNK_BYTES = 2 * 1024 * 1024;
export const MAX_REALTIME_TEXT_CHUNK_LENGTH = 8_000;

export const CHAT_MODELS = [
  'mistral-large-latest',
  'mistral-medium-latest',
  'mistral-small-latest',
];

export const OCR_MODELS = [
  'mistral-ocr-latest',
];

export const DEFAULT_CHAT_MODEL = 'mistral-large-latest';
export const DEFAULT_TEXT_AI_MODEL = 'mistral-small-latest';
export const DEFAULT_OCR_MODEL = 'mistral-ocr-latest';

export const STATUS = {
  PENDING: 'pending',
  QUEUED: 'queued',
  PROCESSING: 'processing',
  TRANSCRIBED: 'transcribed',
  ANALYZING: 'analyzing',
  COMPLETED: 'completed',
  ERROR: 'error',
};

export const STATUS_LABELS = {
  [STATUS.PENDING]: 'Wartend',
  [STATUS.QUEUED]: 'Warteschlange',
  [STATUS.PROCESSING]: 'Transkription',
  [STATUS.TRANSCRIBED]: 'Sprecher zuweisen',
  [STATUS.ANALYZING]: 'Analyse',
  [STATUS.COMPLETED]: 'Abgeschlossen',
  [STATUS.ERROR]: 'Fehler',
};

export const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

export function validatePassword(password) {
  if (password.length < 8) return 'Passwort muss mindestens 8 Zeichen lang sein.';
  if (!/[A-Z]/.test(password)) return 'Passwort muss mindestens einen Großbuchstaben enthalten.';
  if (!/[a-z]/.test(password)) return 'Passwort muss mindestens einen Kleinbuchstaben enthalten.';
  if (!/\d/.test(password)) return 'Passwort muss mindestens eine Zahl enthalten.';
  if (!/[@$!%*?&]/.test(password)) return 'Passwort muss mindestens ein Sonderzeichen enthalten (@$!%*?&).';
  return null;
}

export function normalizeDefaultTemplate(value) {
  if (typeof value !== 'string') return 'generic';
  const template = value.trim();
  if (!template) return 'generic';

  if (['generic', 'meeting', 'aufmass'].includes(template)) return template;
  if (template.startsWith('custom-')) return template;
  return 'generic';
}
