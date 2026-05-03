import crypto from 'crypto';

const REPLAY_WINDOW_SECONDS = 300;

export function verifyVexaSignature({ rawBody, secret, signatureHeader, timestampHeader, now = Date.now() }) {
  if (!secret || !signatureHeader || !timestampHeader) return false;
  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts)) return false;
  const nowSec = Math.floor(now / 1000);
  if (Math.abs(nowSec - ts) > REPLAY_WINDOW_SECONDS) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${ts}.`)
    .update(rawBody)
    .digest('hex');

  const provided = signatureHeader.startsWith('sha256=')
    ? signatureHeader.slice(7)
    : signatureHeader;
  if (expected.length !== provided.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
  } catch {
    return false;
  }
}

export function signVexaPayload({ rawBody, secret, timestampSec }) {
  return crypto
    .createHmac('sha256', secret)
    .update(`${timestampSec}.`)
    .update(rawBody)
    .digest('hex');
}
