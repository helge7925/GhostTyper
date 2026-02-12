import crypto from 'crypto';

const ENCRYPTION_PREFIX = 'v1';
const IV_LENGTH = 12; // AES-GCM nonce size

function getKeyMaterial() {
  return process.env.SETTINGS_ENCRYPTION_KEY || null;
}

function deriveKey() {
  const material = getKeyMaterial();
  if (!material) return null;
  return crypto.createHash('sha256').update(material).digest();
}

export function encryptSecret(plainText) {
  if (!plainText) return null;
  const key = deriveKey();
  if (!key) return null;

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${ENCRYPTION_PREFIX}:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptSecret(value) {
  if (!value) return null;

  const parts = value.split(':');
  if (parts.length !== 4 || parts[0] !== ENCRYPTION_PREFIX) {
    return null;
  }

  const key = deriveKey();
  if (!key) return null;

  try {
    const iv = Buffer.from(parts[1], 'base64');
    const authTag = Buffer.from(parts[2], 'base64');
    const encrypted = Buffer.from(parts[3], 'base64');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}
