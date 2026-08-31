import test from 'node:test';
import assert from 'node:assert/strict';
import { EDENAI_BASE_URL } from '../lib/edenai.js';

// Same DATABASE_URL-guard + dynamic-import pattern as
// tests/edenai-optimize-text.test.mjs.
process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test';
const { analyzeTranscriptionEdenAi, generateTemplateEdenAi } = await import('../lib/edenai-service.js');

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('analyzeTranscriptionEdenAi posts response_format:{type:"json_object"} to /chat/completions', async () => {
  const originalFetch = global.fetch;
  let captured = null;
  global.fetch = async (url, options) => {
    captured = { url: String(url), body: JSON.parse(options.body) };
    return response({ choices: [{ message: { content: '{"summary":"ok"}' } }] });
  };
  try {
    await analyzeTranscriptionEdenAi('some transcript', 'generic', 'k', '', 'mistral/mistral-small-latest');
    assert.equal(captured.url, `${EDENAI_BASE_URL}/chat/completions`);
    assert.equal(captured.body.model, 'mistral/mistral-small-latest');
    assert.deepEqual(captured.body.response_format, { type: 'json_object' });
    assert.equal(captured.body.messages.length, 2);
    assert.equal(captured.body.messages[0].role, 'system');
  } finally {
    global.fetch = originalFetch;
  }
});

test('analyzeTranscriptionEdenAi parses a valid JSON object response into `analysis`', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => response({
    choices: [{ message: { content: '{"topic":"Budget","decisions":["A","B"]}' } }],
    usage: { prompt_tokens: 100, completion_tokens: 20 },
    id: 'chatcmpl-1',
    model: 'mistral/mistral-small-latest',
  });
  try {
    const result = await analyzeTranscriptionEdenAi('text', 'generic', 'k', '', 'mistral/mistral-small-latest');
    assert.deepEqual(result.analysis, { topic: 'Budget', decisions: ['A', 'B'] });
    assert.deepEqual(result.usage, { prompt_tokens: 100, completion_tokens: 20 });
    assert.equal(result.providerRequestId, 'chatcmpl-1');
  } finally {
    global.fetch = originalFetch;
  }
});

test('analyzeTranscriptionEdenAi falls back to {raw: content} when the response is not valid JSON', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => response({ choices: [{ message: { content: 'not json' } }] });
  try {
    const result = await analyzeTranscriptionEdenAi('text', 'generic', 'k', '', 'mistral/mistral-small-latest');
    assert.deepEqual(result.analysis, { raw: 'not json' });
  } finally {
    global.fetch = originalFetch;
  }
});

test('analyzeTranscriptionEdenAi wraps a JSON array response as {raw: content} rather than treating it as the analysis object', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => response({ choices: [{ message: { content: '["a","b"]' } }] });
  try {
    const result = await analyzeTranscriptionEdenAi('text', 'generic', 'k', '', 'mistral/mistral-small-latest');
    assert.deepEqual(result.analysis, { raw: '["a","b"]' });
  } finally {
    global.fetch = originalFetch;
  }
});

test('analyzeTranscriptionEdenAi uses the German system prompt by default and the English one when language is "en"', async () => {
  const originalFetch = global.fetch;
  let captured = null;
  global.fetch = async (_url, options) => { captured = JSON.parse(options.body); return response({ choices: [{ message: { content: '{}' } }] }); };
  try {
    await analyzeTranscriptionEdenAi('text', 'generic', 'k', '', 'mistral/mistral-small-latest');
    assert.match(captured.messages[0].content, /Antworte immer auf Deutsch/);

    await analyzeTranscriptionEdenAi('text', 'generic', 'k', '', 'mistral/mistral-small-latest', 'en');
    assert.match(captured.messages[0].content, /Always respond in English/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('analyzeTranscriptionEdenAi throws MODEL_UNAVAILABLE when no model is given', async () => {
  await assert.rejects(
    analyzeTranscriptionEdenAi('text', 'generic', 'k', '', null),
    (error) => error.code === 'MODEL_UNAVAILABLE',
  );
});

test('generateTemplateEdenAi posts the goal-filled prompt to /chat/completions and returns trimmed promptText', async () => {
  const originalFetch = global.fetch;
  let captured = null;
  global.fetch = async (url, options) => {
    captured = { url: String(url), body: JSON.parse(options.body) };
    return response({
      choices: [{ message: { content: '  You are an assistant that summarizes meetings.  ' } }],
      usage: { prompt_tokens: 30, completion_tokens: 12 },
      id: 'chatcmpl-2',
      model: 'mistral/mistral-small-latest',
    });
  };
  try {
    const result = await generateTemplateEdenAi('summarize meetings', 'k', 'mistral/mistral-small-latest');
    assert.equal(captured.url, `${EDENAI_BASE_URL}/chat/completions`);
    assert.equal(captured.body.model, 'mistral/mistral-small-latest');
    assert.match(captured.body.messages[1].content, /summarize meetings/);
    assert.equal(result.promptText, 'You are an assistant that summarizes meetings.');
    assert.equal(result.providerRequestId, 'chatcmpl-2');
  } finally {
    global.fetch = originalFetch;
  }
});

test('generateTemplateEdenAi throws MODEL_UNAVAILABLE when no model is given', async () => {
  await assert.rejects(
    generateTemplateEdenAi('goal', 'k', null),
    (error) => error.code === 'MODEL_UNAVAILABLE',
  );
});
