const CHAT_OPERATIONS = [
  'analysis',
  'translation',
  'office_translation',
  'text_optimization',
  'template_generation',
  'knowledge_prep',
  'live_translation',
];

const CHAT_PRICES = {
  'deepseek-v4-pro': [1.553, 3.106],
  'deepseek-v4-flash': [0.133, 0.266],
  'kimi-k2.6': [0.694, 3.034],
  'kimi-k2.7-code': [0.673, 3.142],
  'minimax-m3': [0.355, 1.775],
  'mistral-large-latest': [2.00, 6.00],
  'mistral-medium-latest': [0.75, 2.25],
  'mistral-small-latest': [0.20, 0.60],
};

function eurosPerMillionToMicros(value) {
  return Math.round(value * 1_000_000);
}

const chatRows = Object.entries(CHAT_PRICES).flatMap(([model, [input, output]]) =>
  CHAT_OPERATIONS.map((operation) => ({
    provider: 'cortecs',
    model,
    operation,
    inputUnit: 'token',
    outputUnit: 'token',
    inputRate: eurosPerMillionToMicros(input),
    outputRate: eurosPerMillionToMicros(output),
  })),
);

export const INITIAL_PROVIDER_PRICES = [
  ...chatRows,
  { provider: 'cortecs', model: 'whisper-large-v3', operation: 'transcription', inputUnit: 'audio_second', outputUnit: 'token', inputRate: 27_780_000, outputRate: 0 },
  { provider: 'cortecs', model: 'whisper-large-v3', operation: 'meeting_transcription', inputUnit: 'audio_second', outputUnit: 'token', inputRate: 27_780_000, outputRate: 0 },
  { provider: 'fireworks', model: 'whisper-v3', operation: 'transcription', inputUnit: 'audio_second', outputUnit: 'token', inputRate: 56_000_000, outputRate: 0 },
  { provider: 'mistral', model: 'voxtral-mini-latest', operation: 'transcription', inputUnit: 'audio_second', outputUnit: 'token', inputRate: 15_500_000, outputRate: 0 },
  { provider: 'mistral', model: 'voxtral-mini-transcribe-realtime-2602', operation: 'transcription', inputUnit: 'audio_second', outputUnit: 'token', inputRate: 15_500_000, outputRate: 0 },
  ...['voxtral-mini-tts-2603', 'voxtral-tts-latest'].flatMap((model) =>
    ['live_tts', 'live_tts_share', 'in_meeting_tts'].map((operation) => ({
      provider: 'mistral', model, operation, inputUnit: 'character', outputUnit: 'character', inputRate: 0, outputRate: 16_000_000,
    }))),
  // Mistral OCR is billed per page. EUR 1 / 1,000 pages is represented as
  // 1,000,000,000 micro-euros per million pages.
  { provider: 'mistral', model: 'mistral-ocr-latest', operation: 'ocr', inputUnit: 'page', outputUnit: 'token', inputRate: 1_000_000_000, outputRate: 0 },
];

export const INITIAL_PRICING_EFFECTIVE_FROM = '1970-01-01T00:00:00.000Z';
