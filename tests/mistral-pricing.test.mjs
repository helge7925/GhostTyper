import test from 'node:test';
import assert from 'node:assert/strict';

// Same DATABASE_URL-guard + dynamic-import pattern as
// tests/edenai-pricing-gate.test.mjs.
process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test';
const { MISTRAL_OPERATION_MODELS, findMissingMistralPrices } = await import('../lib/mistral-pricing.js');
const { MISTRAL_LIVE_TRANSCRIPTION_MODEL, MISTRAL_TRANSLATION_MODEL } = await import('../lib/mistral.js');
const { PricingConfigurationError } = await import('../lib/pricing-core.js');

test('findMissingMistralPrices reports every direct-Mistral operation when no price row resolves', async () => {
  const missing = await findMissingMistralPrices({
    organizationId: 7,
    resolveProviderPrice: async () => { throw new PricingConfigurationError('no price row'); },
  });
  assert.deepEqual(missing, [
    { model: MISTRAL_LIVE_TRANSCRIPTION_MODEL, operation: 'meeting_transcription' },
    { model: MISTRAL_TRANSLATION_MODEL, operation: 'live_translation' },
  ]);
});

test('findMissingMistralPrices clears once every price row resolves', async () => {
  const missing = await findMissingMistralPrices({
    organizationId: 7,
    resolveProviderPrice: async () => ({ input_unit: 'audio_second' }),
  });
  assert.deepEqual(missing, []);
});

// The real regression this guards: a saved Mistral key switches on BOTH
// consumers at once (no per-capability activation), so pricing one and
// not the other must still block the save — otherwise live translation
// would go live unpriced the moment STT pricing happened to exist.
test('findMissingMistralPrices still blocks when only the STT operation is priced', async () => {
  const missing = await findMissingMistralPrices({
    organizationId: 7,
    resolveProviderPrice: async ({ operation }) => {
      if (operation === 'meeting_transcription') return { input_unit: 'audio_second' };
      throw new PricingConfigurationError('no price row');
    },
  });
  assert.deepEqual(missing, [{ model: MISTRAL_TRANSLATION_MODEL, operation: 'live_translation' }]);
});

test('findMissingMistralPrices propagates errors that are not a pricing-configuration gap', async () => {
  await assert.rejects(
    findMissingMistralPrices({
      organizationId: 7,
      resolveProviderPrice: async () => { throw new Error('db unavailable'); },
    }),
    /db unavailable/,
  );
});

// Live translation bills the chat model, live STT bills the realtime
// audio model — pricing either against the other's model would resolve a
// wildly wrong rate (per-token vs per-audio-second).
test('MISTRAL_OPERATION_MODELS maps each operation to the model that actually serves it', () => {
  assert.deepEqual(MISTRAL_OPERATION_MODELS, {
    meeting_transcription: MISTRAL_LIVE_TRANSCRIPTION_MODEL,
    live_translation: MISTRAL_TRANSLATION_MODEL,
  });
  assert.notEqual(MISTRAL_LIVE_TRANSCRIPTION_MODEL, MISTRAL_TRANSLATION_MODEL);
});

// Every operation the gate checks must have a seeded price row, or saving
// a key is impossible out of the box — the exact failure the automatic
// seeding was introduced to prevent.
test('every gated Mistral operation has a matching seeded price row', async () => {
  const { INITIAL_PROVIDER_PRICES } = await import('../lib/pricing-seed.js');
  for (const [operation, model] of Object.entries(MISTRAL_OPERATION_MODELS)) {
    const row = INITIAL_PROVIDER_PRICES.find(
      (entry) => entry.provider === 'mistral' && entry.model === model && entry.operation === operation,
    );
    assert.ok(row, `no seeded price row for mistral/${model}/${operation}`);
  }
});
