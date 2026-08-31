import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import {
  createCaptureId,
  captureScopeKey,
  captureDisposition,
  isOfflineQueueSupported,
  isRetryableResponse,
  normalizeCapture,
  retryDelayMs,
  uploadQueuedCapture,
} from '../lib/offline-queue.js';

const require = createRequire(import.meta.url);
const {
  STATIC_SHELL_PATHS,
  isApiRequest,
  shouldCacheStaticRequest,
} = require('../public/sw-policy.js');

test('capture records get stable idempotency IDs and initial retry metadata', () => {
  const capture = normalizeCapture({
    kind: 'ocr',
    userId: 7,
    organizationId: 3,
    files: [{ field: 'file', blob: new Blob(['x']), name: 'scan.png' }],
    fields: { analyze: true },
  }, { now: 1000, randomUUID: () => '123e4567-e89b-42d3-a456-426614174000' });
  assert.equal(capture.id, '123e4567-e89b-42d3-a456-426614174000');
  assert.equal(capture.idempotencyKey, capture.id);
  assert.equal(capture.status, 'pending');
  assert.equal(capture.attempts, 0);
  assert.equal(capture.nextAttemptAt, 1000);
  assert.equal(createCaptureId(1000, () => '123e4567-e89b-42d3-a456-426614174001'), '123e4567-e89b-42d3-a456-426614174001');
});

test('capture validation allowlists kinds, endpoints, fields and ownership scope', () => {
  const base = { userId: 7, organizationId: 3, blob: new Blob(['x']) };
  assert.throws(() => normalizeCapture({ ...base, kind: 'video' }), { code: 'invalid_capture' });
  assert.throws(() => normalizeCapture({ ...base, kind: 'audio', endpoint: '/api/ocr' }), { code: 'invalid_capture' });
  assert.throws(() => normalizeCapture({ ...base, kind: 'audio', fields: { admin: true } }), { code: 'invalid_capture' });
  assert.throws(() => normalizeCapture({ ...base, kind: 'audio', userId: null }), { code: 'invalid_capture' });
  assert.equal(normalizeCapture({ ...base, kind: 'photo_table', fields: { analyze: true } }).endpoint, '/api/ocr');
});

test('retry policy backs off with a cap and separates permanent client errors', () => {
  assert.deepEqual([1, 2, 3, 10, 30].map(retryDelayMs), [1000, 2000, 4000, 300000, 300000]);
  assert.equal(isRetryableResponse(408), true);
  assert.equal(isRetryableResponse(409), false);
  assert.equal(isRetryableResponse(429), true);
  assert.equal(isRetryableResponse(503), true);
  assert.equal(isRetryableResponse(400), false);
  assert.equal(captureDisposition(503, 7), 'retry');
  assert.equal(captureDisposition(503, 8), 'failed');
});

test('queue support check fails closed without all browser primitives', () => {
  assert.equal(isOfflineQueueSupported({ indexedDB: {}, FormData: class {} }), true);
  assert.equal(isOfflineQueueSupported({ indexedDB: {} }), false);
});

test('audio sync sends the exact idempotency field then starts processing', async () => {
  const id = '123e4567-e89b-42d3-a456-426614174000';
  const capture = normalizeCapture({
    id,
    kind: 'audio',
    userId: 7,
    organizationId: 3,
    blob: new Blob(['audio']),
    filename: 'capture.webm',
    fields: { template: 'meeting' },
  });
  const calls = [];
  const result = await uploadQueuedCapture(capture, async (url, options) => {
    calls.push({ url, options });
    if (url === '/api/upload') return { ok: true, status: 200, json: async () => ({ id: 42, idempotentReplay: true }) };
    return { ok: true, status: 202 };
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls.map((call) => call.url), ['/api/upload', '/api/transcriptions/42/process']);
  assert.equal(calls[0].options.body.get('clientCaptureId'), id);
  assert.equal(calls[0].options.body.get('clientCaptureUserId'), '7');
  assert.equal(calls[0].options.body.get('clientCaptureOrganizationId'), '3');
  assert.equal(calls[0].options.body.has('capture_id'), false);
});

test('concurrent flush locking is partitioned by user and organization scope', () => {
  assert.notEqual(
    captureScopeKey({ userId: 7, organizationId: 3 }),
    captureScopeKey({ userId: 7, organizationId: 4 }),
  );
  assert.notEqual(
    captureScopeKey({ userId: 7, organizationId: 3 }),
    captureScopeKey({ userId: 8, organizationId: 3 }),
  );
});

test('service worker caches only explicit same-origin static shell assets', () => {
  const origin = 'https://scriptor.example';
  assert.ok(STATIC_SHELL_PATHS.includes('/offline.html'));
  assert.equal(shouldCacheStaticRequest({ requestUrl: `${origin}/icon-192.png`, origin }), true);
  assert.equal(shouldCacheStaticRequest({ requestUrl: `${origin}/_next/static/chunks/app.js`, origin }), true);
  assert.equal(shouldCacheStaticRequest({ requestUrl: `${origin}/transcriptions/1`, origin }), false);
  assert.equal(shouldCacheStaticRequest({ requestUrl: 'https://other.example/icon-192.png', origin }), false);
  assert.equal(shouldCacheStaticRequest({ requestUrl: `${origin}/icon-192.png`, method: 'POST', origin }), false);
});

test('service worker policy keeps all API requests network-only', () => {
  const origin = 'https://scriptor.example';
  assert.equal(isApiRequest(`${origin}/api/transcriptions`, origin), true);
  assert.equal(isApiRequest(`${origin}/api`, origin), true);
  assert.equal(isApiRequest(`${origin}/apiculture`, origin), false);
  assert.equal(shouldCacheStaticRequest({ requestUrl: `${origin}/api/icon-192.png`, origin }), false);
});

test('service worker only deletes GhostTyper app-shell caches during activation', () => {
  const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.match(source, /CACHE_PREFIX = 'ghosttyper-shell-'/);
  assert.match(source, /key\.startsWith\(CACHE_PREFIX\) && key !== CACHE_NAME/);
});
