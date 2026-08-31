import test from 'node:test';
import assert from 'node:assert/strict';

// lib/ai-provider-router.js imports lib/settings-service.js at module
// scope, which transitively imports lib/db.js — throws at load time if
// DATABASE_URL is unset. See tests/settings-service.test.mjs for the same
// pattern: pg's Pool never connects eagerly, and the one test below that
// exercises the real (uninjected) resolvers passes organizationId: null,
// which takes the operator-fallback branch and never queries the DB.
process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test';
const { resolveActiveProviderConfig } = await import('../lib/ai-provider-router.js');

// EDENAI_HARDCODED_MODEL (lib/edenai.js) is a real, non-injectable
// constant now (see hardcode-edenai-models) — models are no longer
// admin-configured, so there's nothing left to fake per-capability the
// way the pre-hardcoding tests faked `defaultModels`. Tests below use the
// real capability names deliberately: `chat` (the one capability with a
// real hardcoded model, `mistral/mistral-small-latest`) exercises the
// "capability is ready" path, and `liveTranscription` (still `null`)
// exercises the "capability has no hardcoded model yet" path — both
// real, current production values, not synthetic stand-ins. `translation`
// and `ocr` are deliberately not used here — neither is a real EdenAI
// capability at all any more (both route through `chat` instead, see
// EDENAI_HARDCODED_MODEL's comment), so `EDENAI_HARDCODED_MODEL.ocr`
// would just be `undefined` rather than a meaningful "not yet decided"
// `null`.
function edenAiStub({ enabled = false, activatedCapabilities = [] } = {}) {
  return async () => ({ enabled, activatedCapabilities, apiKey: enabled ? 'edenai-key' : null });
}

function openRouterStub() {
  return async () => ({ enabled: true, apiKey: 'openrouter-key', defaultModels: { chat: 'vendor/chat-model' } });
}

test('resolveActiveProviderConfig picks EdenAI only when enabled, activated, AND the capability has a hardcoded model', async () => {
  const result = await resolveActiveProviderConfig({
    capability: 'chat',
    resolveEdenAi: edenAiStub({ enabled: true, activatedCapabilities: ['chat'] }),
    resolveOpenRouter: openRouterStub(),
  });
  assert.equal(result.provider, 'edenai');
  assert.equal(result.apiKey, 'edenai-key');
  assert.equal(result.model, 'mistral/mistral-small-latest');
});

test('resolveActiveProviderConfig falls back to OpenRouter when EdenAI is not enabled', async () => {
  const result = await resolveActiveProviderConfig({
    capability: 'chat',
    resolveEdenAi: edenAiStub({ enabled: false, activatedCapabilities: ['chat'] }),
    resolveOpenRouter: openRouterStub(),
  });
  assert.equal(result.provider, 'openrouter');
  assert.equal(result.apiKey, 'openrouter-key');
});

test('resolveActiveProviderConfig falls back to OpenRouter when EdenAI is enabled and activated but this specific capability has no hardcoded model yet', async () => {
  const result = await resolveActiveProviderConfig({
    capability: 'liveTranscription',
    resolveEdenAi: edenAiStub({ enabled: true, activatedCapabilities: ['liveTranscription'] }),
    resolveOpenRouter: openRouterStub(),
  });
  assert.equal(result.provider, 'openrouter');
});

test('resolveActiveProviderConfig falls back to OpenRouter when a capability has a hardcoded model but was never activated (a PUT alone cannot bypass the probe/pricing gate)', async () => {
  const result = await resolveActiveProviderConfig({
    capability: 'chat',
    resolveEdenAi: edenAiStub({ enabled: true, activatedCapabilities: [] }), // enabled, but chat's own activation never ran
    resolveOpenRouter: openRouterStub(),
  });
  assert.equal(result.provider, 'openrouter');
});

test('resolveActiveProviderConfig never calls resolveOpenRouter when EdenAI is chosen', async () => {
  let openRouterCalled = false;
  const result = await resolveActiveProviderConfig({
    capability: 'chat',
    resolveEdenAi: edenAiStub({ enabled: true, activatedCapabilities: ['chat'] }),
    resolveOpenRouter: async () => { openRouterCalled = true; return openRouterStub()(); },
  });
  assert.equal(result.provider, 'edenai');
  assert.equal(openRouterCalled, false);
});

test('resolveActiveProviderConfig propagates a resolveEdenAi failure rather than silently falling back to OpenRouter', async () => {
  let openRouterCalled = false;
  await assert.rejects(
    resolveActiveProviderConfig({
      capability: 'chat',
      resolveEdenAi: async () => { throw new Error('EdenAI config lookup exploded'); },
      resolveOpenRouter: async () => { openRouterCalled = true; return openRouterStub()(); },
    }),
    /EdenAI config lookup exploded/,
  );
  assert.equal(openRouterCalled, false, 'a failure resolving EdenAI must not be masked by a silent OpenRouter fallback');
});

test('resolveActiveProviderConfig defaults to the real DB-backed resolvers when none are injected', async () => {
  // Only asserts the parameters are truly optional (defaults kick in) —
  // the real resolvers themselves need a database and are exercised via
  // tests/settings-service.test.mjs's operator-fallback coverage instead.
  const config = await resolveActiveProviderConfig({ capability: 'chat', organizationId: null });
  assert.ok(config.provider === 'openrouter' || config.provider === 'edenai');
});
