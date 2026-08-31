import test from 'node:test';
import assert from 'node:assert/strict';

// lib/edenai-pricing.js imports lib/pricing-service.js at module scope,
// which imports lib/db.js — throws at load time if DATABASE_URL is
// unset. Every test below injects resolveProviderPrice, so the real
// DB-backed one is never actually called; see tests/settings-service.test.mjs
// for the same placeholder-then-dynamic-import pattern.
process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test';
const { EDENAI_OPERATIONS, findMissingEdenAiPrices } = await import('../lib/edenai-pricing.js');
const { PricingConfigurationError } = await import('../lib/pricing-core.js');

test('EDENAI_OPERATIONS covers every EdenAI capability with a non-empty operation list', () => {
  for (const capability of ['chat', 'transcription', 'liveTranscription', 'tts']) {
    assert.ok(Array.isArray(EDENAI_OPERATIONS[capability]) && EDENAI_OPERATIONS[capability].length > 0, capability);
  }
});

test('translation- and ocr-shaped operations route through chat, not their own capability', () => {
  assert.equal(EDENAI_OPERATIONS.translation, undefined);
  assert.equal(EDENAI_OPERATIONS.ocr, undefined);
  for (const operation of ['translation', 'office_translation', 'live_translation', 'ocr']) {
    assert.ok(EDENAI_OPERATIONS.chat.includes(operation), operation);
  }
});

test('findMissingEdenAiPrices returns an empty list when every operation already has a price', async () => {
  const missing = await findMissingEdenAiPrices({
    capability: 'tts',
    model: 'audio/tts/openai/tts-1',
    organizationId: 42,
    resolveProviderPrice: async () => ({ input_unit: 'character' }),
  });
  assert.deepEqual(missing, []);
});

test('findMissingEdenAiPrices reports every operation missing a price, not just the first', async () => {
  const missing = await findMissingEdenAiPrices({
    capability: 'tts', // tts has 4 operations: tts, live_tts, live_tts_share, in_meeting_tts
    model: 'audio/tts/openai/tts-1',
    organizationId: 42,
    resolveProviderPrice: async () => { throw new PricingConfigurationError('no price row'); },
  });
  assert.deepEqual(missing, EDENAI_OPERATIONS.tts.map((operation) => ({ model: 'audio/tts/openai/tts-1', operation })));
});

test('findMissingEdenAiPrices reports a mix correctly (some priced, some not)', async () => {
  const priced = new Set(['analysis', 'text_optimization']);
  const missing = await findMissingEdenAiPrices({
    capability: 'chat',
    model: 'anthropic/claude-opus-4-7',
    organizationId: 42,
    resolveProviderPrice: async ({ operation }) => {
      if (!priced.has(operation)) throw new PricingConfigurationError('no price row');
      return { input_unit: 'token' };
    },
  });
  assert.deepEqual(
    missing.map((entry) => entry.operation).sort(),
    ['knowledge_prep', 'live_translation', 'ocr', 'office_translation', 'template_generation', 'translation'],
  );
});

test('findMissingEdenAiPrices propagates a non-pricing error rather than misreporting it as a missing price', async () => {
  await assert.rejects(
    findMissingEdenAiPrices({
      capability: 'chat',
      model: 'anthropic/claude-opus-4-7',
      organizationId: 42,
      resolveProviderPrice: async () => { throw new Error('database connection lost'); },
    }),
    /database connection lost/,
  );
});
