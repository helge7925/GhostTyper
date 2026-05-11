import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { detectVersion, hashPassword, verifyPassword } from '../lib/password-hash.js';

test('verifyPassword accepts a v1 (bcrypt) hash', async () => {
  const bcryptHash = await bcrypt.hash('correct-horse-battery-staple', 12);
  const valid = await verifyPassword('correct-horse-battery-staple', bcryptHash, 1);
  assert.equal(valid, true);
});

test('verifyPassword accepts a v2 (argon2id) hash', async () => {
  const { hash } = await hashPassword('correct-horse-battery-staple');
  const valid = await verifyPassword('correct-horse-battery-staple', hash, 2);
  assert.equal(valid, true);
});

test('verifyPassword rejects wrong password for both formats', async () => {
  const bcryptHash = await bcrypt.hash('correct-horse-battery-staple', 12);
  const { hash: argonHash } = await hashPassword('correct-horse-battery-staple');
  assert.equal(await verifyPassword('wrong-password', bcryptHash, 1), false);
  assert.equal(await verifyPassword('wrong-password', argonHash, 2), false);
});

test('hashPassword returns version 2 and an argon2id hash', async () => {
  const { hash, version } = await hashPassword('correct-horse-battery-staple');
  assert.equal(version, 2);
  assert.equal(hash.startsWith('$argon2id$'), true);
});

test('detectVersion returns 2 for argon2id and 1 for bcrypt', async () => {
  const bcryptHash = await bcrypt.hash('correct-horse-battery-staple', 12);
  const { hash: argonHash } = await hashPassword('correct-horse-battery-staple');
  assert.equal(detectVersion(argonHash), 2);
  assert.equal(detectVersion(bcryptHash), 1);
});
