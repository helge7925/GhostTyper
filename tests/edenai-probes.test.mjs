import test from 'node:test';
import assert from 'node:assert/strict';
import { EDENAI_BASE_URL, EdenAiError } from '../lib/edenai.js';
import { probeEdenAiCapability } from '../lib/edenai-probes.js';

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('probeEdenAiCapability requires an API key, a known capability, and a model', async () => {
  await assert.rejects(
    probeEdenAiCapability({ capability: 'chat', model: 'openai/gpt-4o' }),
    (error) => error instanceof EdenAiError && error.code === 'NO_API_KEY',
  );
  await assert.rejects(
    probeEdenAiCapability({ apiKey: 'k', capability: 'not-a-real-capability', model: 'x' }),
    (error) => error instanceof EdenAiError && error.code === 'UNKNOWN_CAPABILITY',
  );
  await assert.rejects(
    probeEdenAiCapability({ apiKey: 'k', capability: 'chat', model: '' }),
    (error) => error instanceof EdenAiError && error.code === 'MODEL_UNAVAILABLE',
  );
});

// The chat probe now makes two calls: a plain-text check, then a
// structured-output (response_format:json_object) check — see
// lib/edenai-probes.js's probeEdenAiChatStructuredOutput. This mock
// branches on the request body's response_format field to answer each
// call correctly.
function chatProbeResponder(calls) {
  return async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url: String(url), body });
    if (body.response_format) {
      return response({ choices: [{ message: { content: JSON.stringify({ status: 'ok', items: ['a', 'b', 'c'] }) } }] });
    }
    return response({ choices: [{ message: { content: 'OK' } }] });
  };
}

test('chat probe posts an OpenAI-shaped message to /chat/completions and accepts a non-empty reply', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = chatProbeResponder(calls);
  try {
    await probeEdenAiCapability({ apiKey: 'k', capability: 'chat', model: 'anthropic/claude-opus-4-7' });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, `${EDENAI_BASE_URL}/chat/completions`);
    assert.equal(calls[0].body.model, 'anthropic/claude-opus-4-7');
    assert.deepEqual(calls[0].body.messages, [{ role: 'user', content: 'Reply with OK.' }]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('chat probe fails when the model returns an empty reply', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => response({ choices: [{ message: { content: '   ' } }] });
  try {
    await assert.rejects(
      probeEdenAiCapability({ apiKey: 'k', capability: 'chat', model: 'openai/gpt-4o' }),
      (error) => error instanceof EdenAiError && error.code === 'CAPABILITY_PROBE_FAILED' && error.details.capability === 'chat',
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('chat probe also runs a structured-output (response_format:json_object) check and posts it correctly', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = chatProbeResponder(calls);
  try {
    await probeEdenAiCapability({ apiKey: 'k', capability: 'chat', model: 'mistral/mistral-small-latest' });
    const structuredCall = calls.find((c) => c.body.response_format);
    assert.ok(structuredCall, 'expected a second call with response_format set');
    assert.deepEqual(structuredCall.body.response_format, { type: 'json_object' });
    assert.equal(structuredCall.body.model, 'mistral/mistral-small-latest');
  } finally {
    global.fetch = originalFetch;
  }
});

test('chat probe fails when structured output is not valid JSON', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.response_format) return response({ choices: [{ message: { content: 'not json at all' } }] });
    return response({ choices: [{ message: { content: 'OK' } }] });
  };
  try {
    await assert.rejects(
      probeEdenAiCapability({ apiKey: 'k', capability: 'chat', model: 'some/model' }),
      (error) => error instanceof EdenAiError
        && error.code === 'CAPABILITY_PROBE_FAILED'
        && error.details.structuredOutput === true,
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('chat probe fails when structured output is valid JSON but the wrong shape', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.response_format) return response({ choices: [{ message: { content: JSON.stringify({ status: 'ok', items: ['only-one'] }) } }] });
    return response({ choices: [{ message: { content: 'OK' } }] });
  };
  try {
    await assert.rejects(
      probeEdenAiCapability({ apiKey: 'k', capability: 'chat', model: 'some/model' }),
      (error) => error instanceof EdenAiError && error.code === 'CAPABILITY_PROBE_FAILED' && error.details.structuredOutput === true,
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('a universal-ai (sync) capability probe requires an explicit input payload, never assumed', async () => {
  await assert.rejects(
    probeEdenAiCapability({ apiKey: 'k', capability: 'tts', model: 'audio/tts/openai/tts-1' }),
    (error) => error instanceof EdenAiError && error.code === 'PROBE_INPUT_REQUIRED',
  );
});

test('TTS probe (sync universal-ai) posts to /universal-ai and accepts a response carrying output', async () => {
  const originalFetch = global.fetch;
  let captured = null;
  global.fetch = async (url, options) => {
    captured = { url: String(url), body: JSON.parse(options.body) };
    return response({ output: { audio_resource_url: 'https://example.com/probe.mp3' } });
  };
  try {
    await probeEdenAiCapability({
      apiKey: 'k',
      capability: 'tts',
      model: 'audio/tts/openai/tts-1',
      input: { text: 'EdenAI capability test.' },
    });
    assert.equal(captured.url, `${EDENAI_BASE_URL}/universal-ai`);
    assert.deepEqual(captured.body, { model: 'audio/tts/openai/tts-1', input: { text: 'EdenAI capability test.' } });
  } finally {
    global.fetch = originalFetch;
  }
});

test('a sync universal-ai probe fails when the response carries no output', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => response({ status: 'error' });
  try {
    await assert.rejects(
      probeEdenAiCapability({ apiKey: 'k', capability: 'tts', model: 'audio/tts/openai/tts-1', input: { text: 'x' } }),
      (error) => error instanceof EdenAiError && error.code === 'CAPABILITY_PROBE_FAILED' && error.details.capability === 'tts',
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('a sync universal-ai probe surfaces EdenAI\'s real error.message, not a generic one, when the API returns status:"fail" with output:null', async () => {
  // Confirmed live 2026-08-28: a sync-mode failure (e.g. an unsupported
  // language) is HTTP 200 with `{status:"fail", output:null, error:{message}}`.
  const originalFetch = global.fetch;
  global.fetch = async () => response({ status: 'fail', output: null, error: { message: 'Provider does not support selected language: `de`', provider_status_code: 500 } });
  try {
    await assert.rejects(
      probeEdenAiCapability({ apiKey: 'k', capability: 'tts', model: 'audio/tts/openai/tts-1', input: { text: 'x' } }),
      (error) => error instanceof EdenAiError
        && error.code === 'CAPABILITY_PROBE_FAILED'
        && error.message.includes('Provider does not support selected language'),
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('an async universal-ai capability probe (e.g. transcription) posts to /universal-ai/async and accepts pending or success', async () => {
  const originalFetch = global.fetch;
  let requestedUrl = null;
  try {
    global.fetch = async (url) => { requestedUrl = String(url); return response({ status: 'processing', public_id: 'job-1' }); };
    await probeEdenAiCapability({
      apiKey: 'k',
      capability: 'transcription',
      model: 'audio/speech_to_text_async/assemblyai',
      input: { file: 'https://example.com/probe.mp3', language: 'en' },
    });
    assert.equal(requestedUrl, `${EDENAI_BASE_URL}/universal-ai/async`);

    global.fetch = async () => response({ status: 'success', output: { text: 'ok' } });
    await probeEdenAiCapability({
      apiKey: 'k',
      capability: 'transcription',
      model: 'audio/speech_to_text_async/assemblyai',
      input: { file: 'https://example.com/probe.mp3', language: 'en' },
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('an async universal-ai capability probe fails when the job itself fails, surfacing the job error', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => response({ status: 'failed', public_id: 'job-1', error: 'unsupported audio format' });
  try {
    await assert.rejects(
      probeEdenAiCapability({
        apiKey: 'k',
        capability: 'transcription',
        model: 'audio/speech_to_text_async/assemblyai',
        input: { file: 'https://example.com/probe.mp3', language: 'en' },
      }),
      (error) => error instanceof EdenAiError
        && error.code === 'CAPABILITY_PROBE_FAILED'
        && error.message.includes('unsupported audio format'),
    );
  } finally {
    global.fetch = originalFetch;
  }
});
