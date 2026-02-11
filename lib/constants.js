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

export const STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  TRANSCRIBED: 'transcribed',
  ANALYZING: 'analyzing',
  COMPLETED: 'completed',
  ERROR: 'error',
};

export const STATUS_LABELS = {
  [STATUS.PENDING]: 'Wartend',
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
