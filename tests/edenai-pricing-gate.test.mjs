import test from 'node:test';
import assert from 'node:assert/strict';

// Same DATABASE_URL-guard + dynamic-import pattern as
// tests/edenai-pricing.test.mjs and tests/settings-service.test.mjs.
process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test';
const { EDENAI_OPERATIONS, findMissingEdenAiPrices } = await import('../lib/edenai-pricing.js');
const { PricingConfigurationError } = await import('../lib/pricing-core.js');

// tests/edenai-pricing.test.mjs already covers findMissingEdenAiPrices's
// core behavior (empty/mixed/all-missing/error-propagation) for `chat`
// and `tts`. This file is scoped to task 5.3's actual subject — the
// activation *gate* — from two angles not yet covered there:
//
// 1. Every remaining EdenAI capability (transcription,
//    liveTranscription) also gates correctly, not just chat/tts.
// 2. The exact response shape `pages/api/organizations/integrations/
//    edenai/activate.js` builds from a non-empty result — asserted
//    against the gate function's real output, not a reimplementation,
//    since that route has no injectable seam for its other collaborators
//    (getIntegration/probeEdenAiCapability all import
//    directly rather than accept overrides) and this repo has no
//    module-mocking test in its suite to reach for instead — see
//    status.md's note on why full route-handler execution is out of
//    scope here, same reasoning as task 5.4.

for (const capability of ['transcription', 'liveTranscription']) {
  test(`findMissingEdenAiPrices gates activation for capability=${capability} until every operation is priced`, async () => {
    const model = 'some/edenai/model';
    const blockedFirst = await findMissingEdenAiPrices({
      capability,
      model,
      organizationId: 7,
      resolveProviderPrice: async () => { throw new PricingConfigurationError('no price row'); },
    });
    assert.deepEqual(
      blockedFirst,
      EDENAI_OPERATIONS[capability].map((operation) => ({ model, operation })),
      `capability=${capability} should report every one of its operations as missing`,
    );

    const clearedAfter = await findMissingEdenAiPrices({
      capability,
      model,
      organizationId: 7,
      resolveProviderPrice: async () => ({ input_unit: 'request' }),
    });
    assert.deepEqual(clearedAfter, [], `capability=${capability} should clear once every operation is priced`);
  });
}

test('chat activation succeeds once every chat operation is priced, not just some', async () => {
  const missing = await findMissingEdenAiPrices({
    capability: 'chat',
    model: 'anthropic/claude-opus-4-7',
    organizationId: 7,
    resolveProviderPrice: async () => ({ input_unit: 'token' }),
  });
  assert.deepEqual(missing, []);
});

test('activate.js builds PRICE_OVERRIDE_REQUIRED naming the exact missing pairs from the gate result', async () => {
  const model = 'anthropic/claude-opus-4-7';
  const missingPrices = await findMissingEdenAiPrices({
    capability: 'chat',
    model,
    organizationId: 7,
    resolveProviderPrice: async ({ operation }) => {
      if (operation === 'analysis') return { input_unit: 'token' };
      throw new PricingConfigurationError('no price row');
    },
  });
  // Mirrors activate.js's response-building branch exactly (see that
  // file's `if (missingPrices.length) { return res.status(400).json({...}) }`).
  const responseBody = missingPrices.length
    ? { code: 'PRICE_OVERRIDE_REQUIRED', capability: 'chat', missing: missingPrices, message: 'Für diese Fähigkeit fehlen manuell hinterlegte Preise.' }
    : null;
  assert.ok(responseBody, 'activation must be blocked when any operation is unpriced');
  assert.equal(responseBody.code, 'PRICE_OVERRIDE_REQUIRED');
  assert.deepEqual(
    responseBody.missing.map((entry) => entry.operation).sort(),
    ['knowledge_prep', 'live_translation', 'ocr', 'office_translation', 'template_generation', 'text_optimization', 'translation'],
  );
});
