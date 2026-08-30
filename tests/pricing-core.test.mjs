import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  calculateUsageCost,
  inferProviderForModel,
  normalizeProviderUsage,
  PricingConfigurationError,
} from '../lib/pricing-core.js';
import { INITIAL_PROVIDER_PRICES } from '../lib/pricing-seed.js';

const price = {
  input_price_per_million_micros: 2_000_000,
  cached_input_price_per_million_micros: 500_000,
  cache_write_price_per_million_micros: 3_000_000,
  output_price_per_million_micros: 4_000_000,
};

test('component pricing subtracts cache reads and writes from standard input', () => {
  const result = calculateUsageCost(price, {
    inputQuantity: 1_000_000,
    cachedInputQuantity: 200_000,
    cacheWriteQuantity: 100_000,
    outputQuantity: 250_000,
  });
  assert.equal(result.standardInputQuantity, 700_000);
  assert.equal(result.inputCostMicros, 1_400_000);
  assert.equal(result.cachedInputCostMicros, 100_000);
  assert.equal(result.cacheWriteCostMicros, 300_000);
  assert.equal(result.outputCostMicros, 1_000_000);
  assert.equal(result.estimatedCostMicros, 2_800_000);
});

test('provider usage normalization supports standard cache counters without double counting', () => {
  assert.deepEqual(normalizeProviderUsage({
    prompt_tokens: 100,
    prompt_tokens_details: { cached_tokens: 30 },
    completion_tokens: 20,
  }), {
    inputQuantity: 100,
    cachedInputQuantity: 30,
    cacheWriteQuantity: 0,
    outputQuantity: 20,
  });
});

test('provider usage normalization adds separately reported cache counters to uncached input', () => {
  assert.deepEqual(normalizeProviderUsage({
    input_tokens: 70,
    cache_read_input_tokens: 20,
    cache_creation_input_tokens: 10,
    output_tokens: 5,
  }), {
    inputQuantity: 100,
    cachedInputQuantity: 20,
    cacheWriteQuantity: 10,
    outputQuantity: 5,
  });
});

test('cache quantities fail closed when their effective rates are absent', () => {
  assert.throws(
    () => calculateUsageCost({ ...price, cached_input_price_per_million_micros: null }, {
      inputQuantity: 100,
      cachedInputQuantity: 10,
    }),
    PricingConfigurationError,
  );
});

test('non-token quantities use the same exact integer calculator', () => {
  const audio = calculateUsageCost({
    input_price_per_million_micros: 15_500_000,
    output_price_per_million_micros: 0,
  }, { audio_duration_seconds: 60 });
  assert.equal(audio.inputQuantity, 60);
  assert.equal(audio.estimatedCostMicros, 930);
});

test('production seed has no fixed models and provider attribution is OpenRouter', () => {
  assert.deepEqual(INITIAL_PROVIDER_PRICES, []);
  assert.equal(inferProviderForModel('vendor/model'), 'openrouter');
});

test('upload transcription resolves its provider dynamically (EdenAI or OpenRouter), not via the inferProviderForModel stub', () => {
  const worker = readFileSync(new URL('../lib/transcription-worker.js', import.meta.url), 'utf8');
  assert.match(worker, /provider: activeTranscription\.provider/);
  assert.match(worker, /resolveActiveProviderConfig\(\{/);
  assert.doesNotMatch(worker, /provider: inferProviderForModel/);
});

test('provider-reported OpenRouter cost is authoritative', () => {
  const result = calculateUsageCost(price, { inputQuantity: 99, outputQuantity: 3, cost: 0.012345 });
  assert.equal(result.actualCostMicros, 12_345);
  assert.equal(result.estimatedCostMicros, 12_345);
});
