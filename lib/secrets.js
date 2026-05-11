import crypto from 'crypto';

// AES-256-GCM secret-at-rest helpers.
//
// History:
//   v1 (pre-2026-05-09) — `sha256(SETTINGS_ENCRYPTION_KEY)` as the AES key.
//                          No HKDF, no AAD, no domain separation. A row's
//                          ciphertext could be lifted into a different
//                          column / row without the application noticing.
//
//   v2 (this revision) — HKDF-SHA256 with a fixed application-wide salt and
//                          info string for domain separation, plus mandatory
//                          AAD binding to (field, organizationId). v2
//                          ciphertexts cannot be moved across columns or
//                          across orgs without setAuthTag verification
//                          failing. See cybersecurity-audit-2026-05-09.md M1.
//
// Migration is one-shot via scripts/reencrypt-secrets.js: decrypts each
// existing v1 row, re-encrypts under v2 with the same plaintext and the
// row's own (field, organization_id) context. Both formats keep working
// during the rollout window — decryptSecret accepts either prefix; v1 is
// returned with no AAD enforcement so unmigrated rows still load.

const V2_PREFIX = 'v2';
const V1_PREFIX = 'v1';
const IV_LENGTH = 12; // AES-GCM nonce
const HKDF_SALT = Buffer.from('romaco-secrets-hkdf-salt-v1', 'utf8');
const HKDF_INFO = 'romaco-secrets-aes256gcm';
const KEY_LENGTH = 32;

function loadKeyMaterial() {
  const m = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!m) return null;
  return Buffer.from(String(m), 'utf8');
}

function deriveKeyV2() {
  const ikm = loadKeyMaterial();
  if (!ikm) return null;
  // crypto.hkdfSync returns an ArrayBuffer in Node 18+; wrap it so we can
  // pass it straight to createCipheriv.
  const derived = crypto.hkdfSync('sha256', ikm, HKDF_SALT, Buffer.from(HKDF_INFO, 'utf8'), KEY_LENGTH);
  return Buffer.from(derived);
}

function deriveKeyV1Legacy() {
  const ikm = loadKeyMaterial();
  if (!ikm) return null;
  return crypto.createHash('sha256').update(ikm).digest();
}

function buildAad(context) {
  if (!context || !context.field) {
    throw new Error('encryptSecret/decryptSecret v2 requires a context with at least a `field`');
  }
  const field = String(context.field);
  // bindingId scopes the ciphertext to a row identity. For org-scoped
  // tables that's organization_id; for per-user tables (settings) it's
  // user_id; either way the AAD prevents row-swap attacks within the
  // same column. Treat unset bindingId as 0 so an attacker can't bypass
  // the check by inserting a NULL row.
  const bindingId = context.bindingId == null ? '0' : String(context.bindingId);
  return Buffer.from(`v2|${field}|${bindingId}`, 'utf8');
}

export function encryptSecret(plainText, context) {
  if (plainText == null || plainText === '') return null;
  const key = deriveKeyV2();
  if (!key) return null;
  const aad = buildAad(context);

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const enc = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${V2_PREFIX}:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(value, context) {
  if (!value) return null;
  const parts = String(value).split(':');
  if (parts.length !== 4) return null;

  if (parts[0] === V2_PREFIX) {
    const key = deriveKeyV2();
    if (!key) return null;
    let aad;
    try {
      aad = buildAad(context);
    } catch {
      return null;
    }
    try {
      const iv = Buffer.from(parts[1], 'base64');
      const tag = Buffer.from(parts[2], 'base64');
      const enc = Buffer.from(parts[3], 'base64');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(aad);
      decipher.setAuthTag(tag);
      const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
      return dec.toString('utf8');
    } catch {
      return null;
    }
  }

  if (parts[0] === V1_PREFIX) {
    // Legacy path — pre-M1 ciphertexts. No AAD validation; the
    // re-encryption migration upgrades these to v2 in place.
    const key = deriveKeyV1Legacy();
    if (!key) return null;
    try {
      const iv = Buffer.from(parts[1], 'base64');
      const tag = Buffer.from(parts[2], 'base64');
      const enc = Buffer.from(parts[3], 'base64');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
      return dec.toString('utf8');
    } catch {
      return null;
    }
  }

  return null;
}

// Helper for the migration script: returns true iff the value still
// uses the v1 format. Lets the migration safely re-encrypt incrementally
// without re-reading the cleartext on a second pass.
export function isLegacySecret(value) {
  if (!value || typeof value !== 'string') return false;
  return value.startsWith(`${V1_PREFIX}:`);
}

export const SECRET_CONTEXTS = {
  // Per-user Mistral key stored in settings.mistral_api_key_encrypted
  mistralApiKey: 'settings.mistral_api_key',
  // Per-org integration config (vexa, mistral) in
  // organization_integrations.config_encrypted
  integrationConfig: 'organization_integrations.config_encrypted',
  // Per-org Vexa user-token in vexa_user_tokens.api_key_encrypted
  vexaUserToken: 'vexa_user_tokens.api_key_encrypted',
};
