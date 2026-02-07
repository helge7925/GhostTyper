export const ACCEPTED_AUDIO_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/ogg',
  'audio/webm',
  'audio/flac',
  'audio/m4a',
  'audio/x-m4a',
  'audio/mp4',
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
