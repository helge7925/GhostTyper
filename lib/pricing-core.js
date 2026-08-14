export const PRICING_UNITS = ['token', 'audio_second', 'character', 'page', 'request'];

export class PricingConfigurationError extends Error {
  constructor(message = 'No effective provider price is configured.') {
    super(message);
    this.name = 'PricingConfigurationError';
    this.code = 'PRICING_CONFIGURATION_MISSING';
  }
}

function nonNegativeInteger(value, field) {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    const error = new TypeError(`${field} must be a non-negative safe integer.`);
    error.code = 'INVALID_USAGE_QUANTITY';
    throw error;
  }
  return parsed;
}

function nullableRate(value, field) {
  if (value === null || value === undefined) return null;
  return nonNegativeInteger(value, field);
}

function rate(price, camel, snake) {
  return nullableRate(price?.[camel] ?? price?.[snake], camel);
}

function roundedMicros(quantity, pricePerMillionMicros) {
  if (!quantity || !pricePerMillionMicros) return 0;
  const numerator = BigInt(quantity) * BigInt(pricePerMillionMicros);
  const result = (numerator + 500_000n) / 1_000_000n;
  const number = Number(result);
  if (!Number.isSafeInteger(number)) throw new RangeError('Calculated cost exceeds the safe integer range.');
  return number;
}

export function normalizeProviderUsage(usage = {}) {
  const details = usage.prompt_tokens_details || usage.input_tokens_details || {};
  const reportedCached = nonNegativeInteger(
    usage.cachedInputQuantity ?? usage.cached_input_quantity ?? usage.cached_input_tokens
      ?? usage.cache_read_input_tokens ?? details.cached_tokens ?? 0,
    'cachedInputQuantity',
  );
  const reportedCacheWrite = nonNegativeInteger(
    usage.cacheWriteQuantity ?? usage.cache_write_quantity ?? usage.cache_creation_input_tokens
      ?? details.cache_write_tokens ?? 0,
    'cacheWriteQuantity',
  );
  const hasExplicitTotal = usage.inputQuantity !== undefined || usage.input_quantity !== undefined
    || usage.prompt_tokens !== undefined;
  const baseInput = nonNegativeInteger(
    usage.inputQuantity ?? usage.input_quantity ?? usage.prompt_tokens ?? usage.input_tokens
      ?? usage.audio_duration_seconds ?? usage.pages_processed ?? usage.pages ?? 0,
    'inputQuantity',
  );
  // Anthropic-style counters report uncached input separately, while OpenAI-
  // style prompt_tokens already includes cache reads. Normalize both shapes to
  // a total input quantity before component pricing.
  const separateCacheCounters = usage.cache_read_input_tokens !== undefined
    || usage.cache_creation_input_tokens !== undefined;
  const totalInput = !hasExplicitTotal && separateCacheCounters
    ? baseInput + reportedCached + reportedCacheWrite
    : baseInput;
  if (!Number.isSafeInteger(totalInput)) throw new RangeError('Normalized input quantity exceeds the safe integer range.');
  const cachedInput = Math.min(totalInput, reportedCached);
  const cacheWrite = Math.min(totalInput - cachedInput, reportedCacheWrite);

  return {
    inputQuantity: totalInput,
    cachedInputQuantity: cachedInput,
    cacheWriteQuantity: cacheWrite,
    outputQuantity: nonNegativeInteger(
      usage.outputQuantity ?? usage.output_quantity ?? usage.completion_tokens ?? usage.output_tokens ?? 0,
      'outputQuantity',
    ),
  };
}

export function calculateUsageCost(price, usage = {}) {
  if (!price) throw new PricingConfigurationError();
  const quantities = normalizeProviderUsage(usage);
  const inputRate = rate(price, 'inputPricePerMillionMicros', 'input_price_per_million_micros');
  const cachedRate = rate(price, 'cachedInputPricePerMillionMicros', 'cached_input_price_per_million_micros');
  const cacheWriteRate = rate(price, 'cacheWritePricePerMillionMicros', 'cache_write_price_per_million_micros');
  const outputRate = rate(price, 'outputPricePerMillionMicros', 'output_price_per_million_micros');

  if (quantities.cachedInputQuantity > 0 && cachedRate === null) {
    throw new PricingConfigurationError('The effective price has no cached-input rate.');
  }
  if (quantities.cacheWriteQuantity > 0 && cacheWriteRate === null) {
    throw new PricingConfigurationError('The effective price has no cache-write rate.');
  }

  const standardInputQuantity = quantities.inputQuantity
    - quantities.cachedInputQuantity
    - quantities.cacheWriteQuantity;
  const inputCostMicros = roundedMicros(standardInputQuantity, inputRate);
  const cachedInputCostMicros = roundedMicros(quantities.cachedInputQuantity, cachedRate);
  const cacheWriteCostMicros = roundedMicros(quantities.cacheWriteQuantity, cacheWriteRate);
  const outputCostMicros = roundedMicros(quantities.outputQuantity, outputRate);
  const estimatedCostMicros = inputCostMicros + cachedInputCostMicros + cacheWriteCostMicros + outputCostMicros;
  if (!Number.isSafeInteger(estimatedCostMicros)) throw new RangeError('Calculated total exceeds the safe integer range.');

  return {
    ...quantities,
    standardInputQuantity,
    inputCostMicros,
    cachedInputCostMicros,
    cacheWriteCostMicros,
    outputCostMicros,
    estimatedCostMicros,
  };
}

export function inferProviderForModel(model) {
  const normalized = String(model || '').toLowerCase();
  if (normalized === 'whisper-v3') return 'fireworks';
  if (normalized.startsWith('voxtral') || normalized === 'mistral-ocr-latest') return 'mistral';
  return 'cortecs';
}
