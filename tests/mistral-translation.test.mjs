import test from 'node:test';
import assert from 'node:assert/strict';
import { translateTextSegmentsMistral } from '../lib/mistral-service.js';
import { MISTRAL_BASE_URL, MISTRAL_TRANSLATION_MODEL, MistralError } from '../lib/mistral.js';

// lib/mistral-service.js imports only lib/mistral.js (dependency-free),
// so unlike the EdenAI adapter tests this needs no DATABASE_URL guard.

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function okTranslations(translations, extra = {}) {
  return response({
    choices: [{ message: { content: JSON.stringify({ translations }) } }],
    ...extra,
  });
}

test('translateTextSegmentsMistral posts an OpenAI-shaped request to Mistral directly', async () => {
  const originalFetch = global.fetch;
  let captured = null;
  global.fetch = async (url, options) => {
    captured = { url: String(url), options, body: JSON.parse(options.body) };
    return okTranslations(['Hallo Welt']);
  };
  try {
    await translateTextSegmentsMistral(['Hello world'], 'de', 'en', 'key', MISTRAL_TRANSLATION_MODEL);
    assert.equal(captured.url, `${MISTRAL_BASE_URL}/chat/completions`);
    assert.equal(captured.options.headers.Authorization, 'Bearer key');
    assert.equal(captured.body.model, MISTRAL_TRANSLATION_MODEL);
    assert.deepEqual(captured.body.response_format, { type: 'json_object' });
    assert.equal(captured.body.temperature, 0.1);
    assert.equal(captured.body.messages[0].role, 'system');
    assert.deepEqual(JSON.parse(captured.body.messages[1].content), { segments: ['Hello world'] });
  } finally {
    global.fetch = originalFetch;
  }
});

test('translateTextSegmentsMistral returns the same shape its EdenAI/OpenRouter counterparts do', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => okTranslations(['Guten Morgen', 'Bis später'], {
    usage: { prompt_tokens: 40, completion_tokens: 12 },
    id: 'cmpl-abc',
    model: 'mistral-small-latest',
  });
  try {
    const result = await translateTextSegmentsMistral(
      ['Good morning', 'See you later'], 'de', 'en', 'key', MISTRAL_TRANSLATION_MODEL,
    );
    assert.deepEqual(result, {
      translations: ['Guten Morgen', 'Bis später'],
      usage: { prompt_tokens: 40, completion_tokens: 12 },
      model: 'mistral-small-latest',
      providerRequestId: 'cmpl-abc',
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('translateTextSegmentsMistral short-circuits on empty input without any request', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('should not be called'); };
  try {
    const result = await translateTextSegmentsMistral([], 'de', 'en', 'key', MISTRAL_TRANSLATION_MODEL);
    assert.deepEqual(result, { translations: [], usage: {}, model: MISTRAL_TRANSLATION_MODEL });
  } finally {
    global.fetch = originalFetch;
  }
});

test('translateTextSegmentsMistral throws MODEL_UNAVAILABLE when no model is given', async () => {
  await assert.rejects(
    translateTextSegmentsMistral(['x'], 'de', 'en', 'key', null),
    (error) => error.code === 'MODEL_UNAVAILABLE',
  );
});

// The length guard is what keeps translated_segments aligned with the
// STT segments array — a silently short array would misattribute
// translations to the wrong speakers/timestamps in the live transcript.
test('translateTextSegmentsMistral rejects a length mismatch and carries provider usage for billing', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => okTranslations(['only one'], {
    usage: { prompt_tokens: 30, completion_tokens: 5 },
    id: 'cmpl-mismatch',
  });
  try {
    await assert.rejects(
      translateTextSegmentsMistral(['a', 'b'], 'de', 'en', 'key', MISTRAL_TRANSLATION_MODEL),
      (error) => error.message === 'SEGMENT_TRANSLATION_SHAPE_MISMATCH'
        && error.providerUsage.prompt_tokens === 30
        && error.providerRequestId === 'cmpl-mismatch',
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('translateTextSegmentsMistral rejects non-JSON content as a shape mismatch', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => response({ choices: [{ message: { content: 'sorry, here is your translation:' } }] });
  try {
    await assert.rejects(
      translateTextSegmentsMistral(['a'], 'de', 'en', 'key', MISTRAL_TRANSLATION_MODEL),
      (error) => error.message === 'SEGMENT_TRANSLATION_SHAPE_MISMATCH',
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('translateTextSegmentsMistral forwards the glossary block and strict-placeholder instruction', async () => {
  const originalFetch = global.fetch;
  let systemPrompt = null;
  global.fetch = async (_url, options) => {
    systemPrompt = JSON.parse(options.body).messages[0].content;
    return okTranslations(['x']);
  };
  try {
    await translateTextSegmentsMistral(['a'], 'de', 'en', 'key', MISTRAL_TRANSLATION_MODEL, {
      glossaryBlock: 'GLOSSARY: Widget => Widget',
      strictPlaceholders: true,
    });
    assert.match(systemPrompt, /GLOSSARY: Widget => Widget/);
    assert.match(systemPrompt, /DNTX0X…XTDN/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('translateTextSegmentsMistral surfaces an HTTP failure as MistralError, 404 as MODEL_UNAVAILABLE', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response('nope', { status: 500 });
  try {
    await assert.rejects(
      translateTextSegmentsMistral(['a'], 'de', 'en', 'key', MISTRAL_TRANSLATION_MODEL),
      (error) => error instanceof MistralError && error.code === 'MISTRAL_REQUEST_FAILED' && error.status === 500,
    );
    global.fetch = async () => new Response('unknown model', { status: 404 });
    await assert.rejects(
      translateTextSegmentsMistral(['a'], 'de', 'en', 'key', MISTRAL_TRANSLATION_MODEL),
      (error) => error instanceof MistralError && error.code === 'MODEL_UNAVAILABLE',
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('translateTextSegmentsMistral refuses to call out without an API key', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('should not be called'); };
  try {
    await assert.rejects(
      translateTextSegmentsMistral(['a'], 'de', 'en', '', MISTRAL_TRANSLATION_MODEL),
      (error) => error instanceof MistralError && error.code === 'NO_API_KEY',
    );
  } finally {
    global.fetch = originalFetch;
  }
});
