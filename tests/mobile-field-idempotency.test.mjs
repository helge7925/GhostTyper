import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertClientCaptureScope,
  isCaptureUniqueViolation,
  normalizeClientCaptureId,
} from '../lib/capture-idempotency-core.js';

test('client capture IDs are optional but strict UUID v4 values when present', () => {
  assert.equal(normalizeClientCaptureId(null), null);
  assert.equal(normalizeClientCaptureId(''), null);
  assert.equal(
    normalizeClientCaptureId(['550E8400-E29B-41D4-A716-446655440000']),
    '550e8400-e29b-41d4-a716-446655440000',
  );
  assert.throws(
    () => normalizeClientCaptureId('shared-or-guessable-id'),
    (error) => error.code === 'INVALID_CLIENT_CAPTURE_ID',
  );
  assert.throws(() => normalizeClientCaptureId('550e8400-e29b-11d4-a716-446655440000'));
});

test('capture scope must match the authenticated user and active organization', () => {
  const base = {
    clientCaptureId: '550e8400-e29b-41d4-a716-446655440000',
    clientCaptureUserId: '7',
    clientCaptureOrganizationId: '3',
    requestUserId: 7,
    requestOrganizationId: 3,
  };
  assert.doesNotThrow(() => assertClientCaptureScope(base));
  assert.throws(
    () => assertClientCaptureScope({ ...base, requestOrganizationId: 4 }),
    (error) => error.code === 'CAPTURE_SCOPE_MISMATCH',
  );
  assert.throws(
    () => assertClientCaptureScope({ ...base, clientCaptureUserId: '' }),
    (error) => error.code === 'CAPTURE_SCOPE_REQUIRED',
  );
  assert.doesNotThrow(() => assertClientCaptureScope({ requestUserId: 7, requestOrganizationId: 3 }));
});

test('only the scoped capture unique constraint is treated as an idempotent race', () => {
  assert.equal(isCaptureUniqueViolation({
    code: '23505',
    constraint: 'uq_transcriptions_org_user_client_capture_id',
  }), true);
  assert.equal(isCaptureUniqueViolation({ code: '23505', constraint: 'users_email_key' }), false);
  assert.equal(isCaptureUniqueViolation({ code: '42P01' }), false);
});
