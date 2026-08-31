import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_PROVIDER_PRICES, INITIAL_PRICING_EFFECTIVE_FROM } from '../lib/pricing-seed.js';
import { PRICING_UNITS } from '../lib/pricing-core.js';

// lib/pricing-service.js imports lib/db.js (for the pg pool), which
// throws at module-load time if DATABASE_URL is unset — same guard
// pattern as tests/edenai-pricing-gate.test.mjs.
process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test';
const { validatePriceVersion } = await import('../lib/pricing-service.js');

// lib/db-init.js's seedProviderPrices() inserts every row here directly
// via raw SQL at app-boot time (see its INSERT ... ON CONFLICT DO
// NOTHING) — a malformed row there would throw inside that transaction
// and break every subsequent boot, not just fail one admin request the
// way a bad /admin/prices submission would. Running each row through the
// same validation createPriceVersion applies (even though the seed path
// itself bypasses it) catches a bad row here, in a fast, DB-less test.
function asValidatePriceVersionInput(row) {
  return {
    provider: row.provider,
    model: row.model,
    operation: row.operation,
    inputUnit: row.inputUnit,
    outputUnit: row.outputUnit,
    inputPricePerMillionMicros: row.inputRate,
    outputPricePerMillionMicros: row.outputRate,
    effectiveFrom: INITIAL_PRICING_EFFECTIVE_FROM,
  };
}

test('INITIAL_PROVIDER_PRICES is non-empty (the whole point of this file)', () => {
  assert.ok(INITIAL_PROVIDER_PRICES.length > 0);
});

test('every seeded row passes validatePriceVersion unchanged', () => {
  for (const row of INITIAL_PROVIDER_PRICES) {
    assert.doesNotThrow(
      () => validatePriceVersion(asValidatePriceVersionInput(row)),
      `row ${row.provider}/${row.model}/${row.operation} failed validation`,
    );
  }
});

test('every seeded row uses a valid PRICING_UNITS value for both input and output', () => {
  for (const row of INITIAL_PROVIDER_PRICES) {
    assert.ok(PRICING_UNITS.includes(row.inputUnit), `${row.operation}: bad inputUnit ${row.inputUnit}`);
    assert.ok(PRICING_UNITS.includes(row.outputUnit), `${row.operation}: bad outputUnit ${row.outputUnit}`);
  }
});

test('every seeded row has non-negative integer rates', () => {
  for (const row of INITIAL_PROVIDER_PRICES) {
    assert.ok(Number.isSafeInteger(row.inputRate) && row.inputRate >= 0, `${row.operation}: bad inputRate`);
    assert.ok(Number.isSafeInteger(row.outputRate) && row.outputRate >= 0, `${row.operation}: bad outputRate`);
  }
});

test('no duplicate (provider, model, operation) rows — each would silently shadow the other at insert time', () => {
  const keys = INITIAL_PROVIDER_PRICES.map((row) => `${row.provider}:${row.model}:${row.operation}`);
  assert.deepEqual(keys, [...new Set(keys)]);
});

test('every EdenAI chat-shaped operation (per lib/edenai-pricing.js EDENAI_OPERATIONS.chat) has a seeded row', () => {
  const chatOperations = ['analysis', 'text_optimization', 'template_generation', 'knowledge_prep', 'translation', 'office_translation', 'live_translation', 'ocr'];
  const seededChatOps = INITIAL_PROVIDER_PRICES
    .filter((row) => row.provider === 'edenai' && row.model === 'mistral/mistral-small-latest')
    .map((row) => row.operation);
  for (const operation of chatOperations) {
    assert.ok(seededChatOps.includes(operation), `missing seeded price for chat operation "${operation}"`);
  }
});

test('every EdenAI TTS operation (per lib/edenai-pricing.js EDENAI_OPERATIONS.tts) has a seeded row', () => {
  const ttsOperations = ['tts', 'live_tts', 'live_tts_share', 'in_meeting_tts'];
  const seededTtsOps = INITIAL_PROVIDER_PRICES
    .filter((row) => row.provider === 'edenai' && row.model === 'audio/tts/google/gemini-2.5-flash-tts')
    .map((row) => row.operation);
  for (const operation of ttsOperations) {
    assert.ok(seededTtsOps.includes(operation), `missing seeded price for tts operation "${operation}"`);
  }
});

test('gladia transcription price matches the documented $0.0102/min rate', () => {
  const row = INITIAL_PROVIDER_PRICES.find(
    (r) => r.provider === 'edenai' && r.model === 'audio/speech_to_text_async/gladia' && r.operation === 'transcription',
  );
  assert.ok(row);
  // 170,000,000 micros / 1e6 audio_seconds = $170/million sec = $0.0102/min
  const dollarsPerMinute = (row.inputRate / 1_000_000 / 1_000_000) * 60;
  assert.ok(Math.abs(dollarsPerMinute - 0.0102) < 0.0001);
});

test('Mistral live-STT price matches the documented $0.006/min rate', () => {
  const row = INITIAL_PROVIDER_PRICES.find(
    (r) => r.provider === 'mistral' && r.model === 'voxtral-mini-transcribe-realtime-2602' && r.operation === 'meeting_transcription',
  );
  assert.ok(row);
  const dollarsPerMinute = (row.inputRate / 1_000_000 / 1_000_000) * 60;
  assert.ok(Math.abs(dollarsPerMinute - 0.006) < 0.0001);
});
