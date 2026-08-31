import test from 'node:test';
import assert from 'node:assert/strict';

// Same DATABASE_URL-guard + dynamic-import pattern as
// tests/edenai-ocr.test.mjs (lib/edenai-service.js transitively reaches
// lib/db.js via lib/ai-service.js).
process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test';
const { synthesizeSpeechEdenAi } = await import('../lib/edenai-service.js');
const { EDENAI_BASE_URL, EDENAI_TTS_DEFAULT_VOICE } = await import('../lib/edenai.js');

// The audio_resource_url step goes through safeFetch (lib/network-guard.js),
// which resolves the hostname via a real DNS lookup unless it's a literal
// IP — 127.0.0.1 skips DNS entirely (net.isIP short-circuits) and is
// allowed as loopback outside production, so these tests stay
// network-independent without needing to mock node:dns. This mirrors how
// lib/tts.js's openRouterTts (same safeFetch dependency) has never had a
// full-round-trip unit test in this suite either — see that gap noted in
// migrate-tts-to-edenai/status.md.
const FAKE_AUDIO_URL = 'http://127.0.0.1/fake-audio.mp3';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('synthesizeSpeechEdenAi returns an empty buffer for blank text without making any request', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('should not be called'); };
  try {
    const result = await synthesizeSpeechEdenAi({ text: '   ', apiKey: 'key', model: 'audio/tts/google/gemini-2.5-flash-tts' });
    assert.equal(result.length, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('synthesizeSpeechEdenAi throws MODEL_UNAVAILABLE when no model is given', async () => {
  await assert.rejects(
    synthesizeSpeechEdenAi({ text: 'hallo', apiKey: 'key', model: null }),
    (error) => error.code === 'MODEL_UNAVAILABLE',
  );
});

test('synthesizeSpeechEdenAi defaults to EDENAI_TTS_DEFAULT_VOICE when no voice is passed', async () => {
  const originalFetch = global.fetch;
  let capturedBody = null;
  global.fetch = async (url, options) => {
    if (String(url).startsWith(EDENAI_BASE_URL)) {
      capturedBody = JSON.parse(options.body);
      return jsonResponse({ status: 'success', cost: 0.001, output: { audio_resource_url: FAKE_AUDIO_URL } });
    }
    return new Response(Buffer.from('fake-mp3-bytes'), { status: 200 });
  };
  try {
    const result = await synthesizeSpeechEdenAi({
      text: 'Hallo Welt', apiKey: 'key', model: 'audio/tts/google/gemini-2.5-flash-tts', format: 'raw',
    });
    assert.equal(capturedBody.input.voice, EDENAI_TTS_DEFAULT_VOICE);
    assert.equal(result.toString(), 'fake-mp3-bytes');
    assert.equal(result.providerRequestId, null);
    assert.deepEqual(result.usage, { cost: 0.001 });
  } finally {
    global.fetch = originalFetch;
  }
});

test('synthesizeSpeechEdenAi forwards an explicit voice instead of the default', async () => {
  const originalFetch = global.fetch;
  let capturedBody = null;
  global.fetch = async (url, options) => {
    if (String(url).startsWith(EDENAI_BASE_URL)) {
      capturedBody = JSON.parse(options.body);
      return jsonResponse({ status: 'success', cost: 0, output: { audio_resource_url: FAKE_AUDIO_URL } });
    }
    return new Response(Buffer.from('bytes'), { status: 200 });
  };
  try {
    await synthesizeSpeechEdenAi({
      text: 'Hallo', voice: 'Vicki', apiKey: 'key', model: 'audio/tts/amazon/neural', format: 'raw',
    });
    assert.equal(capturedBody.input.voice, 'Vicki');
  } finally {
    global.fetch = originalFetch;
  }
});

test('synthesizeSpeechEdenAi surfaces a sync-mode logical failure (200 with status:"fail")', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => jsonResponse({ status: 'fail', output: null, error: { message: 'Provider does not support selected language: xx' } });
  try {
    await assert.rejects(
      synthesizeSpeechEdenAi({ text: 'hallo', apiKey: 'key', model: 'audio/tts/google/gemini-2.5-flash-tts' }),
      (error) => error.code === 'TTS_UPSTREAM_ERROR' && /does not support selected language/.test(error.message),
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('synthesizeSpeechEdenAi throws when the audio download itself fails', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).startsWith(EDENAI_BASE_URL)) {
      return jsonResponse({ status: 'success', output: { audio_resource_url: FAKE_AUDIO_URL } });
    }
    return new Response('gone', { status: 404 });
  };
  try {
    await assert.rejects(
      synthesizeSpeechEdenAi({ text: 'hallo', apiKey: 'key', model: 'audio/tts/google/gemini-2.5-flash-tts', format: 'raw' }),
      (error) => error.code === 'TTS_UPSTREAM_ERROR',
    );
  } finally {
    global.fetch = originalFetch;
  }
});
