import crypto from 'crypto';

function toBuffer(value) {
  if (typeof value !== 'string') return null;
  return Buffer.from(value, 'utf8');
}

export function timingSafeEqualString(left, right) {
  const leftBuffer = toBuffer(left);
  const rightBuffer = toBuffer(right);
  if (!leftBuffer || !rightBuffer) return false;
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function normalizeSingleHeaderValue(value) {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : '';
  }
  return typeof value === 'string' ? value : '';
}
