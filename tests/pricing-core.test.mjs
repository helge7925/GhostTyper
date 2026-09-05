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

test('production seed never bakes in an OpenRouter price (that stays live-synced), and provider attribution stub is OpenRouter', () => {
  // See lib/pricing-seed.js's header comment: OpenRouter prices are
  // intentionally never seeded here (they'd drift from the live-synced
  // catalogue) — EdenAI/Mistral rows are, since neither has a live
  // pricing API and a workspace shouldn't have to wait on a manual admin
  // action just to activate a capability for the first time.
  assert.ok(INITIAL_PROVIDER_PRICES.every((row) => row.provider !== 'openrouter'));
  assert.equal(inferProviderForModel('vendor/model'), 'openrouter');
});

test('upload transcription resolves its provider dynamically (EdenAI or OpenRouter), not via the inferProviderForModel stub', () => {
  const worker = readFileSync(new URL('../lib/transcription-worker.js', import.meta.url), 'utf8');
  assert.match(worker, /provider: activeTranscription\.provider/);
  assert.match(worker, /resolveActiveProviderConfig\(\{/);
  assert.doesNotMatch(worker, /provider: inferProviderForModel/);
});

// Live translation has three possible providers (direct Mistral → EdenAI
// → OpenRouter) but bills through a single `translationProvider`
// variable. The failure this guards is silent and expensive: billing
// `active.provider` (EdenAI/OpenRouter) while the call actually went to
// Mistral would resolve the wrong price row — or none at all, taking down
// live translation with PRICING_CONFIGURATION_MISSING mid-meeting.
test('live in-meeting translation bills the provider it actually called', () => {
  const bridge = readFileSync(new URL('../lib/vexa-bridge.js', import.meta.url), 'utf8');
  const liveTranslationBillingProviders = [...bridge.matchAll(/operation: 'live_translation',\s*\n\s*provider: ([A-Za-z.]+),/g)]
    .map((match) => match[1]);
  assert.equal(liveTranslationBillingProviders.length, 2, 'expected both the guarded and fallback live_translation call sites');
  for (const provider of liveTranslationBillingProviders) {
    assert.equal(provider, 'translationProvider');
  }

  // The invariant is that the billed provider and the called provider cannot
  // diverge, so both must come from one decision. `translationProvider` is
  // that decision (decideTranslationProvider, behaviour-tested in
  // tests/vexa-bridge-utils.test.mjs) and `useMistral` has to be derived from
  // it rather than computed alongside it — two independent computations are
  // exactly how the two could drift apart.
  assert.match(bridge, /const translationProvider = decideTranslationProvider\(/);
  assert.match(bridge, /const useMistral = translationProvider === 'mistral'/);
});

test('provider-reported OpenRouter cost is authoritative', () => {
  const result = calculateUsageCost(price, { inputQuantity: 99, outputQuantity: 3, cost: 0.012345 });
  assert.equal(result.actualCostMicros, 12_345);
  assert.equal(result.estimatedCostMicros, 12_345);
});
