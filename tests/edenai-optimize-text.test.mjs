import test from 'node:test';
import assert from 'node:assert/strict';
import { EDENAI_BASE_URL } from '../lib/edenai.js';

// lib/edenai-service.js now imports lib/ai-service.js (for
// transcribeAudioEdenAi's shared chunking helper), which transitively
// reaches lib/db.js via api-utils.js -> rate-limit.js -> db.js — same
// DATABASE_URL-guard + dynamic-import pattern as
// tests/edenai-pricing-gate.test.mjs and tests/settings-service.test.mjs.
process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test';
const { optimizeTextEdenAi } = await import('../lib/edenai-service.js');

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('optimizeTextEdenAi posts an OpenAI-shaped chat completion request to /chat/completions', async () => {
  const originalFetch = global.fetch;
  let captured = null;
  global.fetch = async (url, options) => {
    captured = { url: String(url), body: JSON.parse(options.body) };
    return response({ choices: [{ message: { content: 'Fixed text.' } }] });
  };
  try {
    await optimizeTextEdenAi('some text', 'clearer', '', 'k', 'mistral/mistral-small-latest');
    assert.equal(captured.url, `${EDENAI_BASE_URL}/chat/completions`);
    assert.equal(captured.body.model, 'mistral/mistral-small-latest');
    assert.equal(captured.body.messages.length, 2);
    assert.equal(captured.body.messages[0].role, 'system');
    assert.equal(captured.body.messages[1].role, 'user');
  } finally {
    global.fetch = originalFetch;
  }
});

test('optimizeTextEdenAi sends the user text as the user message and the preset instruction in the system prompt', async () => {
  const originalFetch = global.fetch;
  let captured = null;
  global.fetch = async (url, options) => {
    captured = JSON.parse(options.body);
    return response({ choices: [{ message: { content: 'ok' } }] });
  };
  try {
    await optimizeTextEdenAi('Ths is a tset.', 'clearer', '', 'k', 'mistral/mistral-small-latest');
    assert.match(captured.messages[0].content, /clearer, better structured/);
    assert.equal(captured.messages[1].content, 'Ths is a tset.');
  } finally {
    global.fetch = originalFetch;
  }
});

test('optimizeTextEdenAi uses the exact same spelling_grammar instruction OpenRouter\'s optimizeText uses', async () => {
  const originalFetch = global.fetch;
  let captured = null;
  global.fetch = async (url, options) => {
    captured = JSON.parse(options.body);
    return response({ choices: [{ message: { content: 'ok' } }] });
  };
  try {
    await optimizeTextEdenAi('text', 'spelling_grammar', '', 'k', 'mistral/mistral-small-latest');
    assert.match(
      captured.messages[0].content,
      /Correct spelling, grammar, punctuation and obvious typos\. Preserve meaning and structure\./,
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('optimizeTextEdenAi includes the custom instruction when given, and falls back to the "clearer" instruction for an unknown preset', async () => {
  const originalFetch = global.fetch;
  let captured = null;
  global.fetch = async (url, options) => {
    captured = JSON.parse(options.body);
    return response({ choices: [{ message: { content: 'ok' } }] });
  };
  try {
    await optimizeTextEdenAi('text', 'not_a_real_preset', 'Keep it under 50 words.', 'k', 'mistral/mistral-small-latest');
    assert.match(captured.messages[0].content, /clearer, better structured/);
    assert.match(captured.messages[0].content, /Keep it under 50 words\./);
  } finally {
    global.fetch = originalFetch;
  }
});

test('optimizeTextEdenAi returns {optimizedText, usage, model, providerRequestId} matching optimizeText\'s contract', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => response({
    choices: [{ message: { content: 'Corrected text.' } }],
    usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
    id: 'chatcmpl-abc123',
    model: 'mistral/mistral-small-latest',
  });
  try {
    const result = await optimizeTextEdenAi('text', 'clearer', '', 'k', 'mistral/mistral-small-latest');
    assert.deepEqual(result, {
      optimizedText: 'Corrected text.',
      usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
      model: 'mistral/mistral-small-latest',
      providerRequestId: 'chatcmpl-abc123',
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('optimizeTextEdenAi throws MODEL_UNAVAILABLE when no model is given', async () => {
  await assert.rejects(
    optimizeTextEdenAi('text', 'clearer', '', 'k', null),
    (error) => error.code === 'MODEL_UNAVAILABLE',
  );
});
