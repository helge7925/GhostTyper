import test from 'node:test';
import assert from 'node:assert/strict';

// Same DATABASE_URL-guard + dynamic-import pattern as
// tests/edenai-pricing-gate.test.mjs.
process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test';
const { MISTRAL_OPERATIONS, findMissingMistralPrices } = await import('../lib/mistral-pricing.js');
const { MISTRAL_LIVE_TRANSCRIPTION_MODEL } = await import('../lib/mistral.js');
const { PricingConfigurationError } = await import('../lib/pricing-core.js');

test('findMissingMistralPrices reports meeting_transcription as missing when no price row resolves', async () => {
  const missing = await findMissingMistralPrices({
    organizationId: 7,
    resolveProviderPrice: async () => { throw new PricingConfigurationError('no price row'); },
  });
  assert.deepEqual(missing, [{ model: MISTRAL_LIVE_TRANSCRIPTION_MODEL, operation: 'meeting_transcription' }]);
});

test('findMissingMistralPrices clears once the price row resolves', async () => {
  const missing = await findMissingMistralPrices({
    organizationId: 7,
    resolveProviderPrice: async () => ({ input_unit: 'audio_second' }),
  });
  assert.deepEqual(missing, []);
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

test('MISTRAL_OPERATIONS only lists the one operation the live-meeting bridge actually bills', () => {
  assert.deepEqual(MISTRAL_OPERATIONS.liveTranscription, ['meeting_transcription']);
});
