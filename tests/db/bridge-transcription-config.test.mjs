// DB-backed suite (real PostgreSQL 16 — see tests/db/helpers.mjs and
// docs/testing.md). Covers the `resolveBridgeTranscriptionConfig()` test
// gap flagged in openspec/changes/migrate-live-meeting-stt-to-edenai
// task 6.4: its structure always queries (even the operator-fallback
// path runs resolveOrgFromMeeting when no organizationId is given), so a
// real database is required. Proves the full resolution chain against
// live rows: meeting-coordinate org resolution, workspace-scoped
// Mistral config decryption, context-bias join, and both fallback
// tiers (operator ENV, then disabled).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupDbTestEnvironment,
  registerSkippedSuite,
  createTestOrganization,
  createTestUser,
  cleanupFixtures,
} from './helpers.mjs';

const SUITE = 'bridge transcription config (PostgreSQL, real rows)';
const env = await setupDbTestEnvironment();

if (env.skip) {
  registerSkippedSuite(SUITE, env.skip);
} else {
  const { pool } = env;
  process.env.SETTINGS_ENCRYPTION_KEY ||= 'db-test-settings-encryption-key';
  const { resolveBridgeTranscriptionConfig, upsertIntegration } = await import('../../lib/integrations.js');
  const { MISTRAL_LIVE_TRANSCRIPTION_MODEL } = await import('../../lib/mistral.js');
  let organizationId;
  let userId;
  const orgIds = new Set();

  before(async () => {
    organizationId = await createTestOrganization(pool);
    userId = await createTestUser(pool);
    orgIds.add(organizationId);
    await pool.query(
      `INSERT INTO transcriptions
         (user_id, organization_id, status, original_name, source, meeting_platform, native_meeting_id)
       VALUES ($1, $2, 'processing', 'db-test-vexa.wav', 'vexa', 'teams', 'native-meeting-42')`,
      [userId, organizationId],
    );
  });

  after(async () => {
    await cleanupFixtures(pool, [...orgIds]);
    await pool.end().catch(() => {});
  });

  test('resolves org from meeting coordinates and returns the workspace Mistral config', async () => {
    await upsertIntegration(organizationId, 'mistral', { apiKey: 'workspace-mistral-key' }, true);
    await pool.query(
      `INSERT INTO organization_settings (organization_id, context_bias) VALUES ($1, 'bias-terms')
       ON CONFLICT (organization_id) DO UPDATE SET context_bias = EXCLUDED.context_bias`,
      [organizationId],
    );

    const config = await resolveBridgeTranscriptionConfig({
      platform: 'teams',
      nativeMeetingId: 'native-meeting-42',
    });

    assert.equal(config.provider, 'mistral');
    assert.equal(config.source, 'workspace');
    assert.equal(config.apiKey, 'workspace-mistral-key');
    assert.equal(config.model, MISTRAL_LIVE_TRANSCRIPTION_MODEL);
    assert.equal(config.contextBias, 'bias-terms');
    assert.equal(Number(config.organizationId), organizationId);
  });

  test('explicit organizationId takes the same workspace path', async () => {
    const config = await resolveBridgeTranscriptionConfig({ organizationId });
    assert.equal(config.source, 'workspace');
    assert.equal(config.apiKey, 'workspace-mistral-key');
  });

  test('workspace without a usable Mistral key falls back to the operator ENV key', async () => {
    const previous = process.env.BRIDGE_TRANSCRIPTION_API_KEY;
    const previousMistral = process.env.MISTRAL_API_KEY;
    process.env.BRIDGE_TRANSCRIPTION_API_KEY = 'operator-bridge-key';
    delete process.env.MISTRAL_API_KEY;
    const bareOrg = await createTestOrganization(pool);
    orgIds.add(bareOrg);
    try {
      const config = await resolveBridgeTranscriptionConfig({ organizationId: bareOrg });
      assert.equal(config.provider, 'mistral');
      assert.equal(config.source, 'operator');
      assert.equal(config.apiKey, 'operator-bridge-key');
      assert.equal(config.contextBias, '');
      assert.equal(config.organizationId, bareOrg);
    } finally {
      if (previous === undefined) delete process.env.BRIDGE_TRANSCRIPTION_API_KEY;
      else process.env.BRIDGE_TRANSCRIPTION_API_KEY = previous;
      if (previousMistral !== undefined) process.env.MISTRAL_API_KEY = previousMistral;
    }
  });

  test('no workspace key and no ENV key yields a disabled config with source null', async () => {
    const previous = process.env.BRIDGE_TRANSCRIPTION_API_KEY;
    const previousMistral = process.env.MISTRAL_API_KEY;
    delete process.env.BRIDGE_TRANSCRIPTION_API_KEY;
    delete process.env.MISTRAL_API_KEY;
    const bareOrg = await createTestOrganization(pool);
    orgIds.add(bareOrg);
    try {
      const config = await resolveBridgeTranscriptionConfig({ organizationId: bareOrg });
      assert.equal(config.provider, 'mistral');
      assert.equal(config.source, null);
      assert.equal(config.apiKey, null);
      assert.equal(config.model, MISTRAL_LIVE_TRANSCRIPTION_MODEL);
      assert.equal(config.organizationId, bareOrg);
    } finally {
      if (previous !== undefined) process.env.BRIDGE_TRANSCRIPTION_API_KEY = previous;
      if (previousMistral !== undefined) process.env.MISTRAL_API_KEY = previousMistral;
    }
  });

  test('unknown meeting coordinates resolve to no organization', async () => {
    const previous = process.env.BRIDGE_TRANSCRIPTION_API_KEY;
    delete process.env.BRIDGE_TRANSCRIPTION_API_KEY;
    const previousMistral = process.env.MISTRAL_API_KEY;
    delete process.env.MISTRAL_API_KEY;
    try {
      const config = await resolveBridgeTranscriptionConfig({
        platform: 'teams',
        nativeMeetingId: 'no-such-meeting',
      });
      assert.equal(config.organizationId, null);
      assert.equal(config.apiKey, null);
      assert.equal(config.source, null);
    } finally {
      if (previous !== undefined) process.env.BRIDGE_TRANSCRIPTION_API_KEY = previous;
      if (previousMistral !== undefined) process.env.MISTRAL_API_KEY = previousMistral;
    }
  });
}
