import test from 'node:test';
import assert from 'node:assert/strict';
import { EDENAI_BASE_URL } from '../lib/edenai.js';

// lib/edenai-service.js now imports lib/ai-service.js (for
// transcribeAudioEdenAi's shared chunking helper), which transitively
// reaches lib/db.js via api-utils.js -> rate-limit.js -> db.js — same
// DATABASE_URL-guard + dynamic-import pattern as
// tests/edenai-pricing-gate.test.mjs and tests/settings-service.test.mjs.
process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test';
const { translateTextEdenAi, translateTextSegmentsEdenAi } = await import('../lib/edenai-service.js');

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('translateTextEdenAi posts an OpenAI-shaped chat completion request to /chat/completions', async () => {
  const originalFetch = global.fetch;
  let captured = null;
  global.fetch = async (url, options) => {
    captured = { url: String(url), body: JSON.parse(options.body) };
    return response({ choices: [{ message: { content: 'Translated text.' } }] });
  };
  try {
    await translateTextEdenAi('some text', 'German', 'English', 'k', 'mistral/mistral-small-latest');
    assert.equal(captured.url, `${EDENAI_BASE_URL}/chat/completions`);
    assert.equal(captured.body.model, 'mistral/mistral-small-latest');
    assert.equal(captured.body.messages.length, 2);
    assert.equal(captured.body.messages[0].role, 'system');
    assert.match(captured.body.messages[0].content, /Translate the provided text into German/);
    assert.equal(captured.body.messages[1].role, 'user');
    assert.equal(captured.body.messages[1].content, 'some text');
  } finally {
    global.fetch = originalFetch;
  }
});

test('translateTextEdenAi includes the glossary block and strict-placeholder instruction when the guard asks for them', async () => {
  const originalFetch = global.fetch;
  let captured = null;
  global.fetch = async (url, options) => {
    captured = JSON.parse(options.body);
    return response({ choices: [{ message: { content: 'ok' } }] });
  };
  try {
    await translateTextEdenAi('text', 'German', 'English', 'k', 'mistral/mistral-small-latest', {
      glossaryBlock: 'Use these fixed translations: "kickoff" -> "Kickoff".',
      strictPlaceholders: true,
    });
    assert.match(captured.messages[0].content, /Use these fixed translations/);
    assert.match(captured.messages[0].content, /CRITICAL: The text contains placeholder tokens/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('translateTextEdenAi returns {translatedText, usage, model, providerRequestId} matching translateText\'s contract', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => response({
    choices: [{ message: { content: 'Übersetzter Text.' } }],
    usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
    id: 'chatcmpl-xyz789',
    model: 'mistral/mistral-small-latest',
  });
  try {
    const result = await translateTextEdenAi('text', 'German', 'English', 'k', 'mistral/mistral-small-latest');
    assert.deepEqual(result, {
      translatedText: 'Übersetzter Text.',
      usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
      model: 'mistral/mistral-small-latest',
      providerRequestId: 'chatcmpl-xyz789',
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('translateTextEdenAi throws MODEL_UNAVAILABLE when no model is given', async () => {
  await assert.rejects(
    translateTextEdenAi('text', 'German', 'English', 'k', null),
    (error) => error.code === 'MODEL_UNAVAILABLE',
  );
});

test('translateTextSegmentsEdenAi posts a strict-JSON chat completion request with response_format json_object', async () => {
  const originalFetch = global.fetch;
  let captured = null;
  global.fetch = async (url, options) => {
    captured = { url: String(url), body: JSON.parse(options.body) };
    return response({ choices: [{ message: { content: JSON.stringify({ translations: ['a', 'b'] }) } }] });
  };
  try {
    await translateTextSegmentsEdenAi(['eins', 'zwei'], 'English', 'German', 'k', 'mistral/mistral-small-latest');
    assert.equal(captured.url, `${EDENAI_BASE_URL}/chat/completions`);
    assert.deepEqual(captured.body.response_format, { type: 'json_object' });
    assert.deepEqual(JSON.parse(captured.body.messages[1].content), { segments: ['eins', 'zwei'] });
  } finally {
    global.fetch = originalFetch;
  }
});

test('translateTextSegmentsEdenAi returns an empty result without calling the provider when given no segments', async () => {
  const originalFetch = global.fetch;
  let called = false;
  global.fetch = async () => { called = true; return response({}); };
  try {
    const result = await translateTextSegmentsEdenAi([], 'English', 'German', 'k', 'mistral/mistral-small-latest');
    assert.deepEqual(result, { translations: [], usage: {}, model: 'mistral/mistral-small-latest' });
    assert.equal(called, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('translateTextSegmentsEdenAi throws SEGMENT_TRANSLATION_SHAPE_MISMATCH when the array length does not match', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => response({
    choices: [{ message: { content: JSON.stringify({ translations: ['only one'] }) } }],
    usage: { total_tokens: 5 },
    id: 'chatcmpl-short',
  });
  try {
    await assert.rejects(
      translateTextSegmentsEdenAi(['eins', 'zwei'], 'English', 'German', 'k', 'mistral/mistral-small-latest'),
      (error) => {
        assert.equal(error.message, 'SEGMENT_TRANSLATION_SHAPE_MISMATCH');
        assert.equal(error.providerRequestId, 'chatcmpl-short');
        return true;
      },
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('translateTextSegmentsEdenAi throws SEGMENT_TRANSLATION_SHAPE_MISMATCH on unparseable content', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => response({ choices: [{ message: { content: 'not json' } }] });
  try {
    await assert.rejects(
      translateTextSegmentsEdenAi(['eins'], 'English', 'German', 'k', 'mistral/mistral-small-latest'),
      (error) => error.message === 'SEGMENT_TRANSLATION_SHAPE_MISMATCH',
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('translateTextSegmentsEdenAi returns {translations, usage, model, providerRequestId} matching translateTextSegments\'s contract', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => response({
    choices: [{ message: { content: JSON.stringify({ translations: ['one', 'two'] }) } }],
    usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
    id: 'chatcmpl-seg123',
    model: 'mistral/mistral-small-latest',
  });
  try {
    const result = await translateTextSegmentsEdenAi(['eins', 'zwei'], 'English', 'German', 'k', 'mistral/mistral-small-latest');
    assert.deepEqual(result, {
      translations: ['one', 'two'],
      usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
      model: 'mistral/mistral-small-latest',
      providerRequestId: 'chatcmpl-seg123',
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('translateTextSegmentsEdenAi throws MODEL_UNAVAILABLE when no model is given', async () => {
  await assert.rejects(
    translateTextSegmentsEdenAi(['text'], 'German', 'English', 'k', null),
    (error) => error.code === 'MODEL_UNAVAILABLE',
  );
});
