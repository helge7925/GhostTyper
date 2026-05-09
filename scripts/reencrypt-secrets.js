#!/usr/bin/env node
/**
 * One-shot migration: re-encrypt every v1 ciphertext under v2 (HKDF +
 * AAD bound to (field, bindingId)). Idempotent — rows that already start
 * with `v2:` are skipped, so the script can be re-run after a partial
 * outage without double-encrypting anything.
 *
 * Implements M1 from docs/cybersecurity-audit-2026-05-09.md.
 *
 * Usage:
 *   SETTINGS_ENCRYPTION_KEY=… node scripts/reencrypt-secrets.js [--dry-run]
 *
 * Exit codes:
 *   0  All v1 rows successfully migrated (or none found).
 *   1  Decrypt failure on at least one row (key mismatch, corruption).
 *   2  Database / config error.
 */
const { Pool } = require('pg');
const crypto = require('crypto');

const DEFAULT_DATABASE_URL = 'postgresql://transkription:transkription@localhost:5432/transkription';
const DRY_RUN = process.argv.includes('--dry-run');

const V1_PREFIX = 'v1';
const V2_PREFIX = 'v2';
const IV_LENGTH = 12;
const HKDF_SALT = Buffer.from('romaco-secrets-hkdf-salt-v1', 'utf8');
const HKDF_INFO = 'romaco-secrets-aes256gcm';
const KEY_LENGTH = 32;

const SECRET_CONTEXTS = {
  mistralApiKey: 'settings.mistral_api_key',
  integrationConfig: 'organization_integrations.config_encrypted',
  vexaUserToken: 'vexa_user_tokens.api_key_encrypted',
};

function loadKeyMaterial() {
  const m = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!m) return null;
  return Buffer.from(String(m), 'utf8');
}

function deriveKeyV2(ikm) {
  const derived = crypto.hkdfSync('sha256', ikm, HKDF_SALT, Buffer.from(HKDF_INFO, 'utf8'), KEY_LENGTH);
  return Buffer.from(derived);
}

function deriveKeyV1Legacy(ikm) {
  return crypto.createHash('sha256').update(ikm).digest();
}

function buildAad(field, bindingId) {
  const id = bindingId == null ? '0' : String(bindingId);
  return Buffer.from(`v2|${field}|${id}`, 'utf8');
}

function decryptV1(value, keyV1) {
  const parts = String(value).split(':');
  if (parts.length !== 4 || parts[0] !== V1_PREFIX) return null;
  try {
    const iv = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const enc = Buffer.from(parts[3], 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyV1, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return dec.toString('utf8');
  } catch {
    return null;
  }
}

function encryptV2(plain, keyV2, field, bindingId) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyV2, iv);
  cipher.setAAD(buildAad(field, bindingId));
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${V2_PREFIX}:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

function isV1(value) {
  return typeof value === 'string' && value.startsWith(`${V1_PREFIX}:`);
}

const TARGETS = [
  {
    label: 'settings.mistral_api_key_encrypted',
    field: SECRET_CONTEXTS.mistralApiKey,
    select: 'SELECT id, user_id AS binding_id, mistral_api_key_encrypted AS ciphertext FROM settings WHERE mistral_api_key_encrypted IS NOT NULL',
    update: 'UPDATE settings SET mistral_api_key_encrypted = $1 WHERE id = $2',
  },
  {
    label: 'organization_integrations.config_encrypted',
    field: SECRET_CONTEXTS.integrationConfig,
    select: 'SELECT id, organization_id AS binding_id, config_encrypted AS ciphertext FROM organization_integrations WHERE config_encrypted IS NOT NULL',
    update: 'UPDATE organization_integrations SET config_encrypted = $1 WHERE id = $2',
  },
  {
    label: 'vexa_user_tokens.api_key_encrypted',
    field: SECRET_CONTEXTS.vexaUserToken,
    select: 'SELECT id, organization_id AS binding_id, api_key_encrypted AS ciphertext FROM vexa_user_tokens WHERE api_key_encrypted IS NOT NULL',
    update: 'UPDATE vexa_user_tokens SET api_key_encrypted = $1 WHERE id = $2',
  },
];

async function migrateTarget(client, target, keyV1, keyV2) {
  console.log(`\n=== ${target.label} ===`);
  let rows;
  try {
    rows = await client.query(target.select);
  } catch (error) {
    if (error?.code === '42P01' || error?.code === '42703') {
      console.log(`  table/column missing — skipping`);
      return { migrated: 0, skipped: 0, failed: 0 };
    }
    throw error;
  }
  let migrated = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of rows.rows) {
    if (!isV1(row.ciphertext)) {
      skipped += 1;
      continue;
    }
    const plain = decryptV1(row.ciphertext, keyV1);
    if (plain == null) {
      failed += 1;
      console.error(`  FAIL: row id=${row.id} could not be decrypted with the v1 key`);
      continue;
    }
    const next = encryptV2(plain, keyV2, target.field, row.binding_id);
    if (DRY_RUN) {
      migrated += 1;
      continue;
    }
    await client.query(target.update, [next, row.id]);
    migrated += 1;
  }
  console.log(`  migrated=${migrated}  already-v2=${skipped}  failed=${failed}${DRY_RUN ? '  (dry-run)' : ''}`);
  return { migrated, skipped, failed };
}

async function main() {
  const ikm = loadKeyMaterial();
  if (!ikm) {
    console.error('SETTINGS_ENCRYPTION_KEY ist nicht gesetzt.');
    process.exit(2);
  }
  const keyV1 = deriveKeyV1Legacy(ikm);
  const keyV2 = deriveKeyV2(ikm);

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
  });
  const client = await pool.connect();
  try {
    if (!DRY_RUN) await client.query('BEGIN');
    const totals = { migrated: 0, skipped: 0, failed: 0 };
    for (const target of TARGETS) {
      const r = await migrateTarget(client, target, keyV1, keyV2);
      totals.migrated += r.migrated;
      totals.skipped += r.skipped;
      totals.failed += r.failed;
    }
    if (!DRY_RUN) {
      if (totals.failed > 0) {
        await client.query('ROLLBACK');
        console.error(`\nROLLBACK — ${totals.failed} row(s) could not be decrypted. No changes were committed.`);
        process.exit(1);
      } else {
        await client.query('COMMIT');
      }
    }
    console.log(`\nTOTAL: migrated=${totals.migrated}  already-v2=${totals.skipped}  failed=${totals.failed}${DRY_RUN ? '  (dry-run)' : ''}`);
    process.exit(totals.failed > 0 ? 1 : 0);
  } catch (error) {
    if (!DRY_RUN) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    }
    console.error('Migration aborted:', error?.message || error);
    process.exit(2);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
