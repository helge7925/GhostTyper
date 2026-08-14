import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  calculateUsageCost,
  inferProviderForModel,
  normalizeProviderUsage,
  PricingConfigurationError,
} from '../lib/pricing-core.js';
import { TRANSCRIPTION_MODELS } from '../lib/constants.js';
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

test('seed catalog includes explicit OCR and corrected provider attribution', () => {
  assert.ok(INITIAL_PROVIDER_PRICES.some((row) =>
    row.provider === 'mistral' && row.model === 'mistral-ocr-latest'
      && row.operation === 'ocr' && row.inputUnit === 'page'));
  assert.ok(INITIAL_PROVIDER_PRICES.some((row) =>
    row.provider === 'cortecs' && row.model === 'whisper-large-v3'
      && row.operation === 'meeting_transcription' && row.inputUnit === 'audio_second'));
  assert.equal(inferProviderForModel('deepseek-v4-pro'), 'cortecs');
  assert.equal(inferProviderForModel('mistral-large-latest'), 'cortecs');
  assert.equal(inferProviderForModel('voxtral-mini-latest'), 'mistral');
});

test('every supported upload transcription model resolves its seeded provider', () => {
  for (const model of TRANSCRIPTION_MODELS) {
    const provider = inferProviderForModel(model);
    assert.ok(INITIAL_PROVIDER_PRICES.some((row) =>
      row.provider === provider && row.model === model && row.operation === 'transcription'),
    `missing transcription price for ${provider}/${model}`);
  }
  const worker = readFileSync(new URL('../lib/transcription-worker.js', import.meta.url), 'utf8');
  assert.match(worker, /inferProviderForModel\(cortecs\.transcriptionModel\)/);
  assert.doesNotMatch(worker, /operation: 'transcription',[\s\S]{0,100}provider: 'cortecs'/);
});
