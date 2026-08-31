import test from 'node:test';
import assert from 'node:assert/strict';

// Same DATABASE_URL-guard + dynamic-import pattern as
// tests/edenai-pricing.test.mjs — lib/integrations.js imports lib/db.js
// at module scope.
process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test';
const { redactConfig } = await import('../lib/integrations.js');
const { normalizeEdenAiConfig } = await import('../lib/edenai.js');

// Task 5.4 asks for a secret non-disclosure test on the EdenAI GET/PUT
// routes (pages/api/organizations/integrations/edenai.js), mirroring an
// equivalent OpenRouter test. No such route-level test exists for *any*
// provider in this suite — none of pages/api's route handlers are
// imported by a test anywhere in tests/, and this route has no
// injectable seam for its collaborators (getIntegration/upsertIntegration
// import directly rather than accept overrides), so invoking it directly
// would mean introducing module-mocking infra this repo's test suite
// doesn't use anywhere else, for a single provider's route.
//
// What actually enforces secret non-disclosure is `redactConfig` —
// generic across every provider (Vexa/Nextcloud/OpenRouter/EdenAI alike)
// and called directly in both the GET and PUT handlers
// (`redactConfig(config)` / `redactConfig(next.config)`) as the last step
// before every response. Testing it here, against a real
// `normalizeEdenAiConfig` output (the exact shape the route passes
// through), covers the real risk — that an EdenAI apiKey leaks into a
// JSON response — at the one shared choke point that actually prevents
// it, without inventing new route-mocking infra for this one route.

test('redactConfig strips a configured EdenAI apiKey and reports apiKeyConfigured:true', () => {
  const config = normalizeEdenAiConfig({ apiKey: 'edenai-live-secret-key-do-not-leak' });
  const redacted = redactConfig(config);
  assert.equal(redacted.apiKey, undefined);
  assert.equal(JSON.stringify(redacted).includes('edenai-live-secret-key-do-not-leak'), false);
  assert.equal(redacted.apiKeyConfigured, true);
});

test('redactConfig reports apiKeyConfigured:false when no EdenAI apiKey is set', () => {
  const config = normalizeEdenAiConfig({});
  const redacted = redactConfig(config);
  assert.equal(redacted.apiKey, undefined);
  assert.equal(redacted.apiKeyConfigured, false);
});

test('redactConfig passes non-secret EdenAI fields through unchanged', () => {
  const config = normalizeEdenAiConfig({
    apiKey: 'edenai-live-secret-key-do-not-leak',
    ttsVoices: { 'audio/tts/openai/tts-1': 'Rachel' },
    activatedCapabilities: ['chat'],
  });
  const redacted = redactConfig(config);
  assert.deepEqual(redacted.ttsVoices, { 'audio/tts/openai/tts-1': 'Rachel' });
  assert.deepEqual(redacted.activatedCapabilities, ['chat']);
});
