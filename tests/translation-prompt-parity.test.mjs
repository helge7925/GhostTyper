import test from 'node:test';
import assert from 'node:assert/strict';

// lib/ai-service.js reaches lib/db.js transitively — same DATABASE_URL
// guard + dynamic import as the other adapter tests.
process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test';
const { translateTextSegments } = await import('../lib/ai-service.js');
const { translateTextSegmentsEdenAi } = await import('../lib/edenai-service.js');
const { translateTextSegmentsMistral } = await import('../lib/mistral-service.js');

// Three providers now build the segment-translation system prompt from
// three separately-maintained copies of the same template (the codebase's
// established pattern — see each adapter's "kept byte-for-byte identical"
// comment). Duplication is only safe if drift is caught, so this asserts
// the three really do produce identical prompts for identical inputs,
// including the glossary and strict-placeholder branches. If someone
// tweaks one adapter's wording, this fails instead of silently giving one
// provider different translation behavior from the others.

async function captureSystemPrompt(callAdapter) {
  const originalFetch = global.fetch;
  let systemPrompt = null;
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options?.body || '{}');
    if (systemPrompt === null && Array.isArray(body.messages)) {
      const system = body.messages.find((m) => m.role === 'system');
      if (system) systemPrompt = system.content;
    }
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify({ translations: ['x'] }) } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  try {
    await callAdapter();
  } finally {
    global.fetch = originalFetch;
  }
  assert.ok(systemPrompt, 'adapter made no request carrying a system message');
  return systemPrompt;
}

const SEGMENTS = ['Hello world'];
const MODEL = 'some-model';

async function promptsForAllThreeProviders(options) {
  const openrouter = await captureSystemPrompt(() => translateTextSegments(
    SEGMENTS, 'de', 'en', 'key', MODEL, options,
  ));
  const edenai = await captureSystemPrompt(() => translateTextSegmentsEdenAi(
    SEGMENTS, 'de', 'en', 'key', MODEL, options,
  ));
  const mistral = await captureSystemPrompt(() => translateTextSegmentsMistral(
    SEGMENTS, 'de', 'en', 'key', MODEL, options,
  ));
  return { openrouter, edenai, mistral };
}

test('all three providers build an identical segment-translation prompt (plain)', async () => {
  const { openrouter, edenai, mistral } = await promptsForAllThreeProviders({});
  assert.equal(edenai, openrouter, 'EdenAI prompt drifted from OpenRouter');
  assert.equal(mistral, openrouter, 'Mistral prompt drifted from OpenRouter');
});

test('all three providers build an identical prompt with a glossary block', async () => {
  const options = { glossaryBlock: 'GLOSSARY:\nWidget => Widget' };
  const { openrouter, edenai, mistral } = await promptsForAllThreeProviders(options);
  assert.match(mistral, /Widget => Widget/);
  assert.equal(edenai, openrouter, 'EdenAI glossary prompt drifted from OpenRouter');
  assert.equal(mistral, openrouter, 'Mistral glossary prompt drifted from OpenRouter');
});

test('all three providers build an identical prompt with strict placeholders', async () => {
  const options = { strictPlaceholders: true };
  const { openrouter, edenai, mistral } = await promptsForAllThreeProviders(options);
  assert.match(mistral, /DNTX0X…XTDN/);
  assert.equal(edenai, openrouter, 'EdenAI strict-placeholder prompt drifted from OpenRouter');
  assert.equal(mistral, openrouter, 'Mistral strict-placeholder prompt drifted from OpenRouter');
});

test('all three providers request the same strict-JSON response contract', async () => {
  const originalFetch = global.fetch;
  const bodies = [];
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options?.body || '{}');
    if (Array.isArray(body.messages)) bodies.push(body);
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify({ translations: ['x'] }) } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  try {
    await translateTextSegmentsEdenAi(SEGMENTS, 'de', 'en', 'key', MODEL, {});
    await translateTextSegmentsMistral(SEGMENTS, 'de', 'en', 'key', MODEL, {});
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(bodies.length, 2);
  for (const body of bodies) {
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.equal(body.temperature, 0.1);
  }
});
