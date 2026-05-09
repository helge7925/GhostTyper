import argon2 from 'argon2';
import bcrypt from 'bcryptjs';

// M12 (cybersecurity-audit-2026-05-09): migrate from legacy bcryptjs hashes
// to argon2id for newly written passwords while keeping backward-compatible
// verification and enabling deferred transparent rehash on next login.
export async function hashPassword(plainText) {
  const hash = await argon2.hash(plainText, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  return { hash, version: 2 };
}

export async function verifyPassword(plainText, storedHash, version) {
  if (!plainText || !storedHash) return false;
  try {
    if (version === 2 || detectVersion(storedHash) === 2) {
      return await argon2.verify(storedHash, plainText);
    }
    return await bcrypt.compare(plainText, storedHash);
  } catch {
    return false;
  }
}

export function detectVersion(hash) {
  if (typeof hash !== 'string') return 1;
  return hash.startsWith('$argon2') ? 2 : 1;
}
