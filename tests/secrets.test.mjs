import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  encryptSecret,
  decryptSecret,
  isLegacySecret,
  SECRET_CONTEXTS,
} from '../lib/secrets.js';

const ORIGINAL_KEY = process.env.SETTINGS_ENCRYPTION_KEY;
process.env.SETTINGS_ENCRYPTION_KEY = 'unit-test-encryption-key-please-keep-stable';

test.after(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.SETTINGS_ENCRYPTION_KEY;
  else process.env.SETTINGS_ENCRYPTION_KEY = ORIGINAL_KEY;
});

test('encryptSecret returns null for empty/null plaintext', () => {
  const ctx = { field: 'test.col', bindingId: 1 };
  assert.equal(encryptSecret(null, ctx), null);
  assert.equal(encryptSecret('', ctx), null);
  assert.equal(encryptSecret(undefined, ctx), null);
});

test('encryptSecret throws when context lacks `field`', () => {
  assert.throws(() => encryptSecret('s3cr3t', {}));
  assert.throws(() => encryptSecret('s3cr3t', null));
  assert.throws(() => encryptSecret('s3cr3t'));
});

test('round-trip succeeds with matching context', () => {
  const ctx = { field: SECRET_CONTEXTS.mistralApiKey, bindingId: 42 };
  const enc = encryptSecret('plain-mistral-key', ctx);
  assert.ok(enc.startsWith('v2:'), 'expected v2 prefix');
  const dec = decryptSecret(enc, ctx);
  assert.equal(dec, 'plain-mistral-key');
});

test('decryptSecret with wrong field returns null (AAD mismatch)', () => {
  const enc = encryptSecret('s3cr3t', { field: SECRET_CONTEXTS.mistralApiKey, bindingId: 5 });
  const wrong = decryptSecret(enc, { field: SECRET_CONTEXTS.vexaUserToken, bindingId: 5 });
  assert.equal(wrong, null);
});

test('decryptSecret with wrong bindingId returns null (AAD mismatch)', () => {
  const ctx = { field: SECRET_CONTEXTS.mistralApiKey, bindingId: 1 };
  const enc = encryptSecret('s3cr3t', ctx);
  const wrong = decryptSecret(enc, { field: SECRET_CONTEXTS.mistralApiKey, bindingId: 2 });
  assert.equal(wrong, null);
});

test('two encrypts of the same plaintext produce different ciphertexts (random IV)', () => {
  const ctx = { field: SECRET_CONTEXTS.integrationConfig, bindingId: 1 };
  const a = encryptSecret('same-plain', ctx);
  const b = encryptSecret('same-plain', ctx);
  assert.notEqual(a, b);
});

test('decryptSecret accepts legacy v1 ciphertexts with no AAD', () => {
  // Synthesize a v1 ciphertext using the SHA-256 derivation from pre-M1.
  // This mirrors what already lives in production tables until the
  // re-encryption migration runs.
  const key = crypto.createHash('sha256')
    .update(process.env.SETTINGS_ENCRYPTION_KEY)
    .digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update('legacy-plain', 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const v1 = `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
  assert.equal(isLegacySecret(v1), true);

  // Any context still decrypts a v1 row (no AAD on the legacy path).
  const dec = decryptSecret(v1, { field: SECRET_CONTEXTS.mistralApiKey, bindingId: 99 });
  assert.equal(dec, 'legacy-plain');
});

test('isLegacySecret rejects v2 / null / non-string', () => {
  const enc = encryptSecret('plain', { field: SECRET_CONTEXTS.mistralApiKey, bindingId: 1 });
  assert.equal(isLegacySecret(enc), false);
  assert.equal(isLegacySecret(null), false);
  assert.equal(isLegacySecret(''), false);
  assert.equal(isLegacySecret(42), false);
});
