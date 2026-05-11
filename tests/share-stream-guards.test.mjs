import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acquireStreamSlot,
  getCurrentSlotCount,
  ShareConcurrencyLimitError,
} from '../lib/share-stream-guards.js';

test('acquireStreamSlot increments and decrements per token+kind', () => {
  const token = 'aaaaaaaaaaaaaaaa1';
  assert.equal(getCurrentSlotCount(token, 'audio'), 0);

  const r1 = acquireStreamSlot(token, 'audio', 3);
  assert.equal(getCurrentSlotCount(token, 'audio'), 1);

  const r2 = acquireStreamSlot(token, 'audio', 3);
  assert.equal(getCurrentSlotCount(token, 'audio'), 2);

  r1();
  assert.equal(getCurrentSlotCount(token, 'audio'), 1);

  r2();
  assert.equal(getCurrentSlotCount(token, 'audio'), 0);
});

test('acquireStreamSlot enforces the max cap', () => {
  const token = 'bbbbbbbbbbbbbbbb1';
  const releases = [];
  for (let i = 0; i < 3; i++) {
    releases.push(acquireStreamSlot(token, 'audio', 3));
  }
  assert.throws(
    () => acquireStreamSlot(token, 'audio', 3),
    (err) => err instanceof ShareConcurrencyLimitError && err.code === 'SHARE_CONCURRENCY_LIMIT',
  );
  releases[0]();
  // After release, a new slot is available again.
  releases.push(acquireStreamSlot(token, 'audio', 3));
  for (const r of releases) r();
});

test('acquireStreamSlot release is idempotent', () => {
  const token = 'cccccccccccccccc1';
  const release = acquireStreamSlot(token, 'audio', 3);
  assert.equal(getCurrentSlotCount(token, 'audio'), 1);
  release();
  release();
  release();
  assert.equal(getCurrentSlotCount(token, 'audio'), 0);
});

test('acquireStreamSlot keeps audio and stream kinds independent', () => {
  const token = 'dddddddddddddddd1';
  const r1 = acquireStreamSlot(token, 'audio', 3);
  const r2 = acquireStreamSlot(token, 'stream', 5);
  assert.equal(getCurrentSlotCount(token, 'audio'), 1);
  assert.equal(getCurrentSlotCount(token, 'stream'), 1);
  r1();
  r2();
});

test('acquireStreamSlot only differentiates the first 16 token chars', () => {
  // The audit / acquire bucket trims the token to 16 chars to keep error
  // logs and rate-limit IDs short. Two URLs with the same prefix must share
  // a bucket.
  const tokenA = '0123456789abcdefAAAAAAAA';
  const tokenB = '0123456789abcdefBBBBBBBB';
  const r = acquireStreamSlot(tokenA, 'audio', 3);
  assert.equal(getCurrentSlotCount(tokenB, 'audio'), 1);
  r();
});
