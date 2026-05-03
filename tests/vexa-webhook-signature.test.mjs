import test from 'node:test';
import assert from 'node:assert/strict';
import { signVexaPayload, verifyVexaSignature } from '../lib/vexa-webhook-signature.js';

const SECRET = 'whsec_test_secret';

test('verifyVexaSignature accepts a valid signature', () => {
  const ts = Math.floor(Date.now() / 1000);
  const body = Buffer.from('{"event_type":"meeting.completed"}');
  const sig = signVexaPayload({ rawBody: body, secret: SECRET, timestampSec: ts });
  assert.equal(
    verifyVexaSignature({
      rawBody: body,
      secret: SECRET,
      signatureHeader: `sha256=${sig}`,
      timestampHeader: String(ts),
    }),
    true,
  );
});

test('verifyVexaSignature accepts the bare hex form too', () => {
  const ts = Math.floor(Date.now() / 1000);
  const body = Buffer.from('hello');
  const sig = signVexaPayload({ rawBody: body, secret: SECRET, timestampSec: ts });
  assert.equal(
    verifyVexaSignature({
      rawBody: body,
      secret: SECRET,
      signatureHeader: sig,
      timestampHeader: String(ts),
    }),
    true,
  );
});

test('verifyVexaSignature rejects when the body has been tampered with', () => {
  const ts = Math.floor(Date.now() / 1000);
  const body = Buffer.from('original');
  const sig = signVexaPayload({ rawBody: body, secret: SECRET, timestampSec: ts });
  assert.equal(
    verifyVexaSignature({
      rawBody: Buffer.from('tampered'),
      secret: SECRET,
      signatureHeader: `sha256=${sig}`,
      timestampHeader: String(ts),
    }),
    false,
  );
});

test('verifyVexaSignature rejects when the wrong secret is used', () => {
  const ts = Math.floor(Date.now() / 1000);
  const body = Buffer.from('payload');
  const sig = signVexaPayload({ rawBody: body, secret: SECRET, timestampSec: ts });
  assert.equal(
    verifyVexaSignature({
      rawBody: body,
      secret: 'wrong_secret',
      signatureHeader: `sha256=${sig}`,
      timestampHeader: String(ts),
    }),
    false,
  );
});

test('verifyVexaSignature rejects expired timestamps (replay window)', () => {
  const now = Date.now();
  const oldTs = Math.floor(now / 1000) - 600;
  const body = Buffer.from('old payload');
  const sig = signVexaPayload({ rawBody: body, secret: SECRET, timestampSec: oldTs });
  assert.equal(
    verifyVexaSignature({
      rawBody: body,
      secret: SECRET,
      signatureHeader: `sha256=${sig}`,
      timestampHeader: String(oldTs),
      now,
    }),
    false,
  );
});

test('verifyVexaSignature rejects when headers are missing', () => {
  const body = Buffer.from('payload');
  assert.equal(verifyVexaSignature({ rawBody: body, secret: SECRET }), false);
  assert.equal(
    verifyVexaSignature({ rawBody: body, secret: SECRET, signatureHeader: 'sha256=abc' }),
    false,
  );
});
