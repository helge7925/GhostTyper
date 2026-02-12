const { Pool } = require('pg');
const crypto = require('crypto');

const ENCRYPTION_PREFIX = 'v1';
const IV_LENGTH = 12; // AES-GCM nonce size
const DEFAULT_DATABASE_URL = 'postgresql://transkription:transkription@localhost:5432/transkription';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
});

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function getKeyMaterial() {
  return process.env.SETTINGS_ENCRYPTION_KEY || null;
}

function deriveKey() {
  const material = getKeyMaterial();
  if (!material) return null;
  return crypto.createHash('sha256').update(material).digest();
}

function encryptSecret(plainText, key) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${ENCRYPTION_PREFIX}:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptSecret(value, key) {
  if (!value) return null;

  const parts = value.split(':');
  if (parts.length !== 4 || parts[0] !== ENCRYPTION_PREFIX) {
    return null;
  }

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

function formatError(error) {
  if (!error) return 'Unbekannter Fehler';

  if (Array.isArray(error.errors) && error.errors.length > 0) {
    const nested = error.errors
      .map((entry) => (entry && entry.message ? entry.message : String(entry)))
      .join(' | ');
    const label = error.message || error.name || 'AggregateError';
    return `${label}: ${nested}`;
  }

  if (error.message) return error.message;
  return String(error);
}

async function migrateApiKeys() {
  const dryRun = hasFlag('--dry-run');
  const key = deriveKey();

  if (!key) {
    throw new Error(
      'SETTINGS_ENCRYPTION_KEY ist erforderlich, um API-Keys verschluesselt zu migrieren.'
    );
  }

  const client = await pool.connect();

  try {
    // Backward-compatible guard for older schemas.
    await client.query('ALTER TABLE settings ADD COLUMN IF NOT EXISTS mistral_api_key_encrypted TEXT');

    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT id, mistral_api_key, mistral_api_key_encrypted
       FROM settings
       WHERE NULLIF(TRIM(mistral_api_key), '') IS NOT NULL
       FOR UPDATE`
    );

    const stats = {
      scanned: rows.length,
      migrated: 0,
      cleaned_plaintext: 0,
      reencrypted: 0,
      unchanged: 0,
    };

    for (const row of rows) {
      const plainApiKey = typeof row.mistral_api_key === 'string' ? row.mistral_api_key.trim() : '';
      const existingEncrypted = typeof row.mistral_api_key_encrypted === 'string'
        ? row.mistral_api_key_encrypted.trim()
        : '';

      if (!plainApiKey) {
        stats.unchanged += 1;
        continue;
      }

      let nextEncrypted = existingEncrypted || null;

      if (!existingEncrypted) {
        nextEncrypted = encryptSecret(plainApiKey, key);
        stats.migrated += 1;
      } else {
        const decrypted = decryptSecret(existingEncrypted, key);
        if (!decrypted) {
          nextEncrypted = encryptSecret(plainApiKey, key);
          stats.reencrypted += 1;
        } else {
          stats.cleaned_plaintext += 1;
        }
      }

      if (!dryRun) {
        await client.query(
          `UPDATE settings
           SET mistral_api_key = NULL,
               mistral_api_key_encrypted = $2,
               updated_at = NOW()
           WHERE id = $1`,
          [row.id, nextEncrypted]
        );
      }
    }

    if (dryRun) {
      await client.query('ROLLBACK');
    } else {
      await client.query('COMMIT');
    }

    console.log('--- GhostTyper API-Key Migration ---');
    console.log(`Modus: ${dryRun ? 'DRY-RUN (keine Aenderungen gespeichert)' : 'WRITE'}`);
    console.log(`Gepruefte Datensaetze: ${stats.scanned}`);
    console.log(`Neu verschluesselt (legacy plaintext): ${stats.migrated}`);
    console.log(`Re-encrypted (ungueltige Ciphertexte ersetzt): ${stats.reencrypted}`);
    console.log(`Plaintext entfernt (gueltige Ciphertexte vorhanden): ${stats.cleaned_plaintext}`);
    console.log(`Unveraendert: ${stats.unchanged}`);
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback failures
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrateApiKeys().catch((error) => {
  console.error('Fehler bei der API-Key-Migration:', formatError(error));
  process.exit(1);
});
