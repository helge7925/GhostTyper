/**
 * Restore runner — the other half of scripts/backup.js.
 *
 *   node scripts/restore.js ./backups/2026-09-06T07-41-12Z --verify-only
 *   node scripts/restore.js ./backups/2026-09-06T07-41-12Z --confirm
 *
 * This one is destructive: it drops and recreates every object the dump
 * contains, and overwrites the uploads directory. So it does nothing at all
 * without --confirm, and --verify-only is the default posture: check the
 * manifest, check every checksum, report what would happen, change nothing.
 *
 * Checksums are verified before anything is touched. A backup that was
 * truncated by a full disk or a killed cron job is a file of plausible size
 * that restores into a half-empty database, and the moment you discover that
 * is the worst possible one. Better to refuse up front.
 */

const { spawn } = require('child_process');
const { createHash } = require('crypto');
const { createReadStream } = require('fs');
const { readFile, stat } = require('fs/promises');
const path = require('path');

const DEFAULT_DATABASE_URL = 'postgresql://transkription:transkription@localhost:5432/transkription';
const DATABASE_URL = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
const UPLOADS_PARENT = process.cwd();

const CONFIRMED = process.argv.includes('--confirm');
const VERIFY_ONLY = process.argv.includes('--verify-only') || !CONFIRMED;
const SKIP_UPLOADS = process.argv.includes('--db-only');

const source = process.argv.slice(2).find((arg) => !arg.startsWith('--'));

function log(event, details = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), event, verifyOnly: VERIFY_ONLY, details }));
}

function fail(event, details = {}) {
  console.error(JSON.stringify({ timestamp: new Date().toISOString(), event, level: 'error', details }));
  process.exitCode = 1;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'inherit', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      reject(error.code === 'ENOENT'
        ? new Error(`${command} not found. Install the PostgreSQL client tools.`)
        : error);
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      // pg_restore reports 1 for non-fatal warnings (a missing role, an
      // extension that already exists) and still restores the data, so the
      // caller decides rather than this helper.
      else reject(Object.assign(new Error(`${command} exited with ${code}: ${stderr.trim()}`), { exitCode: code }));
    });
  });
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function verifyArtefacts(dir, manifest) {
  const problems = [];
  for (const [name, expected] of Object.entries(manifest.artefacts || {})) {
    const filePath = path.join(dir, name);
    let actualSize;
    try {
      actualSize = (await stat(filePath)).size;
    } catch {
      problems.push(`${name}: missing`);
      continue;
    }
    if (actualSize !== expected.bytes) {
      problems.push(`${name}: ${actualSize} bytes, manifest says ${expected.bytes}`);
      continue;
    }
    const actualHash = await sha256(filePath);
    if (actualHash !== expected.sha256) {
      problems.push(`${name}: checksum mismatch`);
    }
  }
  return problems;
}

async function main() {
  if (!source) {
    fail('restore.no_source', { usage: 'node scripts/restore.js <backup-directory> [--confirm] [--db-only]' });
    return;
  }

  const dir = path.resolve(process.cwd(), source);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
  } catch (error) {
    fail('restore.manifest_unreadable', { dir, message: error.message });
    return;
  }

  log('restore.manifest_read', {
    dir,
    createdAt: manifest.createdAt,
    database: manifest.database,
    includesUploads: Boolean(manifest.includesUploads),
    artefacts: Object.keys(manifest.artefacts || {}),
  });

  const problems = await verifyArtefacts(dir, manifest);
  if (problems.length > 0) {
    fail('restore.verification_failed', { problems });
    return;
  }
  log('restore.verified', { artefacts: Object.keys(manifest.artefacts || {}) });

  // The encrypted provider credentials in the dump can only be read with the
  // key that encrypted them. Restoring into an environment with a different
  // key (or none) leaves every integration silently unreadable, which surfaces
  // much later as "the API key vanished".
  if (manifest.secretEncryptionKeyConfigured && !process.env.SECRET_ENCRYPTION_KEY) {
    log('restore.secret_key_warning', {
      message: 'Backup was taken with SECRET_ENCRYPTION_KEY set, but none is configured here. '
        + 'Encrypted provider credentials will not be readable after the restore.',
    });
  }

  if (VERIFY_ONLY) {
    log('restore.verify_only_complete', {
      wouldRestore: {
        database: DATABASE_URL.replace(/\/\/[^@]*@/, '//***@'),
        uploads: manifest.includesUploads && !SKIP_UPLOADS ? path.join(UPLOADS_PARENT, 'uploads') : null,
      },
      hint: 'Re-run with --confirm to apply. This overwrites the target database and uploads directory.',
    });
    return;
  }

  const dumpPath = path.join(dir, 'database.dump');
  log('restore.database_started', { target: DATABASE_URL.replace(/\/\/[^@]*@/, '//***@') });
  try {
    await run('pg_restore', ['--clean', '--if-exists', '--no-owner', '--no-acl', '--dbname', DATABASE_URL, dumpPath]);
  } catch (error) {
    // Exit code 1 means warnings only; anything else is a real failure and
    // must not be followed by overwriting the uploads directory as well.
    if (error.exitCode !== 1) throw error;
    log('restore.database_warnings', { message: error.message });
  }
  log('restore.database_restored', {});

  if (manifest.includesUploads && !SKIP_UPLOADS) {
    const uploadsArchive = path.join(dir, 'uploads.tar.gz');
    await run('tar', ['-xzf', uploadsArchive, '-C', UPLOADS_PARENT]);
    log('restore.uploads_restored', { into: path.join(UPLOADS_PARENT, 'uploads') });
  }

  log('restore.completed', {
    hint: 'Run `npm run audit:verify` to confirm the audit chain survived the round trip.',
  });
}

main().catch((error) => {
  fail('restore.failed', { message: error.message });
});
