import test from 'node:test';
import assert from 'node:assert/strict';
import { EDENAI_BASE_URL } from '../lib/edenai.js';
import { OPENROUTER_BASE_URL, OPENROUTER_CAPABILITIES } from '../lib/openrouter.js';

// lib/settings-service.js transitively imports lib/db.js, which throws at
// module-load time if DATABASE_URL is unset. pg's Pool never connects
// eagerly (only on first query), and no test below passes an
// organizationId to resolveEdenAiConfig/resolveOpenRouterConfig, so no
// query ever actually runs — a syntactically-valid placeholder is enough
// to satisfy the load-time guard. Set before the (necessarily dynamic, so
// it runs after this assignment) import of the module under test.
process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test';
const { resolveEdenAiConfig, resolveOpenRouterConfig } = await import('../lib/settings-service.js');

// resolveEdenAiConfig's organization-scoped branch calls getIntegration(),
// which hits the real database — untestable here without the
// tests/db/ real-Postgres pattern this repo reserves for row-lock/outbox
// semantics specifically. These tests cover the operator-fallback branch
// (no organizationId), which is pure and deterministic, mirroring the
// same subset of resolveOpenRouterConfig's behavior that is unit-testable
// without a database.

test('resolveEdenAiConfig falls back to the operator EDENAI_API_KEY env var when no organization is given', async () => {
  const original = process.env.EDENAI_API_KEY;
  process.env.EDENAI_API_KEY = 'operator-secret';
  try {
    const config = await resolveEdenAiConfig({ userId: 42 });
    assert.equal(config.enabled, false);
    assert.equal(config.apiKey, 'operator-secret');
    assert.equal(config.baseUrl, EDENAI_BASE_URL);
    assert.equal(config.source, 'operator');
    assert.equal(config.organizationId, null);
    assert.equal(config.userId, 42);
    for (const capability of ['chat', 'translation', 'ocr', 'transcription', 'liveTranscription', 'tts']) {
      assert.deepEqual(config.allowedModels[capability], []);
      assert.equal(config.defaultModels[capability], '');
    }
  } finally {
    if (original === undefined) delete process.env.EDENAI_API_KEY;
    else process.env.EDENAI_API_KEY = original;
  }
});

test('resolveEdenAiConfig has no operator source when EDENAI_API_KEY is unset', async () => {
  const original = process.env.EDENAI_API_KEY;
  delete process.env.EDENAI_API_KEY;
  try {
    const config = await resolveEdenAiConfig({});
    assert.equal(config.apiKey, null);
    assert.equal(config.source, null);
  } finally {
    if (original !== undefined) process.env.EDENAI_API_KEY = original;
  }
});

// resolveOpenRouterConfig's organization-scoped branch calls getIntegration(),
// which hits the real database — same limitation as resolveEdenAiConfig
// above, so it is not unit-tested here. In particular, the "org has
// enabled the integration but relies on the operator's shared key rather
// than storing its own" case (usable=true, config.apiKey empty) only
// happens inside that branch and would need the tests/db/ real-Postgres
// pattern (or module mocking, which this repo does not use) to exercise
// directly. These tests cover the operator-fallback branch (no
// organizationId), which is pure, deterministic, and was the one that
// regressed: a later `...normalizeOpenRouterConfig({})` spread in the
// returned object literal silently overwrote the computed `apiKey` back
// to null even when OPENROUTER_API_KEY was set.

test('resolveOpenRouterConfig falls back to the operator OPENROUTER_API_KEY env var when no organization is given', async () => {
  const original = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'operator-secret';
  try {
    const config = await resolveOpenRouterConfig({ userId: 42 });
    assert.equal(config.enabled, false);
    assert.equal(config.apiKey, 'operator-secret');
    assert.equal(config.baseUrl, OPENROUTER_BASE_URL);
    assert.equal(config.source, 'operator');
    assert.equal(config.organizationId, null);
    assert.equal(config.userId, 42);
    for (const capability of OPENROUTER_CAPABILITIES) {
      assert.deepEqual(config.allowedModels[capability], []);
      assert.equal(config.defaultModels[capability], '');
    }
  } finally {
    if (original === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = original;
  }
});

test('resolveOpenRouterConfig has no operator source when OPENROUTER_API_KEY is unset', async () => {
  const original = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    const config = await resolveOpenRouterConfig({});
    assert.equal(config.apiKey, null);
    assert.equal(config.source, null);
  } finally {
    if (original !== undefined) process.env.OPENROUTER_API_KEY = original;
  }
});
