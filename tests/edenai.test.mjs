import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EDENAI_BASE_URL,
  EDENAI_CAPABILITIES,
  EDENAI_CAPABILITY_MODEL_SHAPE,
  EDENAI_HARDCODED_MODEL,
  EdenAiError,
  edenAiHeaders,
  edenAiJsonRequest,
  isEdenAiFeatureAsync,
  normalizeEdenAiConfig,
  pollEdenAiAsyncJob,
  submitEdenAiAsyncJob,
} from '../lib/edenai.js';

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('EDENAI_BASE_URL targets the v3 API, never the legacy v2 surface', () => {
  assert.equal(EDENAI_BASE_URL, 'https://api.edenai.run/v3');
});

test('EDENAI_CAPABILITIES lists all four GhostTyper-level capabilities', () => {
  assert.deepEqual(EDENAI_CAPABILITIES, [
    'chat',
    'transcription',
    'liveTranscription',
    'tts',
  ]);
});

test('translation and ocr are not their own capabilities — both route through chat', () => {
  for (const capability of ['translation', 'ocr']) {
    assert.equal(EDENAI_CAPABILITIES.includes(capability), false, capability);
    assert.equal(EDENAI_CAPABILITY_MODEL_SHAPE[capability], undefined, capability);
  }
});

test('every capability has a model-shape entry', () => {
  for (const capability of EDENAI_CAPABILITIES) {
    assert.ok(EDENAI_CAPABILITY_MODEL_SHAPE[capability], `missing shape for ${capability}`);
  }
});

test('chat uses the OpenAI-compatible provider/model-id shape, not a universal-ai category/subfeature pair', () => {
  assert.equal(EDENAI_CAPABILITY_MODEL_SHAPE.chat.kind, 'chat');
  assert.equal(EDENAI_CAPABILITY_MODEL_SHAPE.chat.category, undefined);
  assert.equal(EDENAI_CAPABILITY_MODEL_SHAPE.chat.subfeature, undefined);
});

test('non-chat capabilities carry a universal-ai category/subfeature pair', () => {
  for (const capability of EDENAI_CAPABILITIES) {
    if (capability === 'chat') continue;
    const shape = EDENAI_CAPABILITY_MODEL_SHAPE[capability];
    assert.equal(shape.kind, 'universal');
    assert.equal(typeof shape.category, 'string');
    assert.equal(typeof shape.subfeature, 'string');
  }
});

test('transcription and liveTranscription share the same async speech-to-text category/subfeature', () => {
  assert.equal(
    EDENAI_CAPABILITY_MODEL_SHAPE.transcription.subfeature,
    EDENAI_CAPABILITY_MODEL_SHAPE.liveTranscription.subfeature,
  );
  assert.equal(EDENAI_CAPABILITY_MODEL_SHAPE.transcription.category, 'audio');
  assert.equal(EDENAI_CAPABILITY_MODEL_SHAPE.transcription.subfeature, 'speech_to_text_async');
});

test('isEdenAiFeatureAsync detects the _async suffix EdenAI uses to route to /universal-ai/async', () => {
  assert.equal(isEdenAiFeatureAsync('speech_to_text_async'), true);
  assert.equal(isEdenAiFeatureAsync('automatic_translation'), false);
  assert.equal(isEdenAiFeatureAsync('ocr'), false);
  assert.equal(isEdenAiFeatureAsync(undefined), false);
});

test('EDENAI_HARDCODED_MODEL has one entry per capability; chat, transcription and tts are decided, liveTranscription is permanently excluded', () => {
  for (const capability of EDENAI_CAPABILITIES) {
    assert.ok(Object.prototype.hasOwnProperty.call(EDENAI_HARDCODED_MODEL, capability), `missing entry for ${capability}`);
  }
  assert.equal(EDENAI_HARDCODED_MODEL.chat, 'mistral/mistral-small-latest');
  assert.equal(EDENAI_HARDCODED_MODEL.transcription, 'audio/speech_to_text_async/gladia');
  assert.equal(EDENAI_HARDCODED_MODEL.tts, 'audio/tts/google/gemini-2.5-flash-tts');
  // liveTranscription stays null by design — live-meeting STT routes
  // through a direct Mistral integration instead, see
  // migrate-live-meeting-stt-to-edenai/specs/edenai-provider/spec.md.
  assert.equal(EDENAI_HARDCODED_MODEL.liveTranscription, null);
});

test('normalizeEdenAiConfig defaults to no api key, empty ttsVoices and activatedCapabilities', () => {
  const normalized = normalizeEdenAiConfig();
  assert.equal(normalized.apiKey, null);
  assert.deepEqual(normalized.ttsVoices, {});
  assert.deepEqual(normalized.activatedCapabilities, []);
  assert.equal(normalized.activatedAt, null);
  assert.equal(normalized.schemaVersion, 1);
});

test('normalizeEdenAiConfig keeps only known, deduped capabilities in activatedCapabilities', () => {
  const normalized = normalizeEdenAiConfig({
    activatedCapabilities: ['chat', 'chat', 'tts', 'not-a-real-capability'],
  });
  assert.deepEqual(normalized.activatedCapabilities, ['chat', 'tts']);
});

test('normalizeEdenAiConfig trims the API key and drops ttsVoices with an invalid model id or blank voice', () => {
  const normalized = normalizeEdenAiConfig({
    apiKey: '  secret-key  ',
    ttsVoices: {
      'audio/tts/elevenlabs': '  Rachel  ',
      'bad model': 'ignored because the model id is invalid',
      'audio/tts/lovoai': '   ',
    },
  });
  assert.equal(normalized.apiKey, 'secret-key');
  assert.deepEqual(normalized.ttsVoices, { 'audio/tts/elevenlabs': 'Rachel' });
});

test('edenAiHeaders sends a bare bearer token, no ZDR/provider passthrough (unlike OpenRouter)', () => {
  assert.deepEqual(edenAiHeaders('secret-key'), { Authorization: 'Bearer secret-key' });
  assert.deepEqual(edenAiHeaders('secret-key', { 'Content-Type': 'application/json' }), {
    Authorization: 'Bearer secret-key',
    'Content-Type': 'application/json',
  });
});

test('edenAiJsonRequest posts JSON to the given path with a bearer header and no ZDR/provider-preference injection', async () => {
  const originalFetch = global.fetch;
  let captured = null;
  global.fetch = async (url, options) => {
    captured = { url: String(url), method: options.method, headers: options.headers, body: JSON.parse(options.body) };
    return response({ choices: [{ message: { content: 'ok' } }] });
  };
  try {
    const result = await edenAiJsonRequest('/chat/completions', { model: 'mistral/mistral-small-latest', messages: [] }, 'request-test-key');
    assert.equal(captured.url, `${EDENAI_BASE_URL}/chat/completions`);
    assert.equal(captured.method, 'POST');
    assert.equal(captured.headers.Authorization, 'Bearer request-test-key');
    assert.equal(captured.headers['Content-Type'], 'application/json');
    assert.equal(captured.body.provider, undefined, 'EdenAI has no confirmed ZDR/data_collection request field, unlike OpenRouter');
    assert.equal(result.choices[0].message.content, 'ok');
  } finally {
    global.fetch = originalFetch;
  }
});

test('edenAiJsonRequest maps a 404 to MODEL_UNAVAILABLE and other failures to EDENAI_REQUEST_FAILED', async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => response({ error: 'no such model' }, 404);
    await assert.rejects(
      edenAiJsonRequest('/chat/completions', {}, 'k'),
      (error) => error instanceof EdenAiError && error.code === 'MODEL_UNAVAILABLE',
    );
    global.fetch = async () => response({ error: 'rate limited' }, 429);
    await assert.rejects(
      edenAiJsonRequest('/chat/completions', {}, 'k'),
      (error) => error instanceof EdenAiError && error.code === 'EDENAI_REQUEST_FAILED' && error.status === 429,
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('submitEdenAiAsyncJob returns an inline success result without a job id when EdenAI resolves it synchronously', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => response({ status: 'success', output: { text: 'transcribed inline' } });
  try {
    const result = await submitEdenAiAsyncJob({ model: 'audio/speech_to_text_async/assemblyai', input: {} }, 'k');
    assert.deepEqual(result, { status: 'success', jobId: null, output: { text: 'transcribed inline' } });
  } finally {
    global.fetch = originalFetch;
  }
});

test('submitEdenAiAsyncJob returns the public_id job id (not job_id) when EdenAI defers the job', async () => {
  const originalFetch = global.fetch;
  let requestedUrl = null;
  global.fetch = async (url) => {
    requestedUrl = String(url);
    return response({ status: 'processing', public_id: 'job-123' });
  };
  try {
    const result = await submitEdenAiAsyncJob({ model: 'audio/speech_to_text_async/assemblyai', input: {} }, 'k');
    assert.equal(requestedUrl, `${EDENAI_BASE_URL}/universal-ai/async`);
    assert.deepEqual(result, { status: 'processing', jobId: 'job-123' });
  } finally {
    global.fetch = originalFetch;
  }
});

test('pollEdenAiAsyncJob checks GET /universal-ai/async/{id} once and normalizes success/failed/pending', async () => {
  const originalFetch = global.fetch;
  let requestedUrl = null;
  try {
    global.fetch = async (url) => { requestedUrl = String(url); return response({ status: 'success', public_id: 'job-123', output: { text: 'done' } }); };
    const success = await pollEdenAiAsyncJob('job-123', 'k');
    assert.equal(requestedUrl, `${EDENAI_BASE_URL}/universal-ai/async/job-123`);
    assert.deepEqual(success, { status: 'success', jobId: 'job-123', output: { text: 'done' } });

    global.fetch = async () => response({ status: 'failed', public_id: 'job-123', error: 'provider timeout' });
    const failed = await pollEdenAiAsyncJob('job-123', 'k');
    assert.deepEqual(failed, { status: 'failed', jobId: 'job-123', error: 'provider timeout' });

    global.fetch = async () => response({ status: 'processing', public_id: 'job-123' });
    const pending = await pollEdenAiAsyncJob('job-123', 'k');
    assert.deepEqual(pending, { status: 'processing', jobId: 'job-123' });
  } finally {
    global.fetch = originalFetch;
  }
});

test('pollEdenAiAsyncJob URL-encodes the job id', async () => {
  const originalFetch = global.fetch;
  let requestedUrl = null;
  global.fetch = async (url) => { requestedUrl = String(url); return response({ status: 'processing' }); };
  try {
    await pollEdenAiAsyncJob('job/with slashes', 'k');
    assert.equal(requestedUrl, `${EDENAI_BASE_URL}/universal-ai/async/job%2Fwith%20slashes`);
  } finally {
    global.fetch = originalFetch;
  }
});
