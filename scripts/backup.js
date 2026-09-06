/**
 * Backup runner.
 *
 *   node scripts/backup.js                    # database + uploads into ./backups
 *   node scripts/backup.js --out /mnt/backup  # somewhere else
 *   node scripts/backup.js --db-only          # skip the uploads archive
 *   node scripts/backup.js --dry-run          # report what would be written
 *
 * Writes one directory per run containing three files:
 *
 *   database.dump   pg_dump custom format (compressed, restores with pg_restore)
 *   uploads.tar.gz  the uploads directory, if it exists and --db-only is not set
 *   manifest.json   sizes, SHA-256 of each artefact, and the versions involved
 *
 * The manifest is what makes a backup checkable rather than merely present:
 * scripts/restore.js verifies every checksum before it touches anything, so a
 * silently truncated dump is caught before it replaces a working database.
 *
 * Deliberately NOT included: the .env file. It holds SECRET_ENCRYPTION_KEY,
 * without which the encrypted provider credentials in this dump are
 * unreadable — which is exactly why it must not sit in the same archive as
 * them. Back it up separately, somewhere the backup operator cannot reach.
 * The manifest records whether a key was configured at backup time so a
 * restore can warn when the two have drifted apart.
 *
 * Logs one line of JSON per event, like scripts/apply-retention-policy.js, so
 * it can be dropped into cron or a systemd timer and shipped to a log
 * collector without further work.
 */

const { spawn } = require('child_process');
const { createHash } = require('crypto');
const { createReadStream } = require('fs');
const { mkdir, stat, writeFile, readdir } = require('fs/promises');
const path = require('path');

const DEFAULT_DATABASE_URL = 'postgresql://transkription:transkription@localhost:5432/transkription';
const DATABASE_URL = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');

const DRY_RUN = process.argv.includes('--dry-run');
const DB_ONLY = process.argv.includes('--db-only');

function argValue(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index === process.argv.length - 1) return fallback;
  return process.argv[index + 1];
}

const OUT_ROOT = path.resolve(process.cwd(), argValue('--out', 'backups'));

function log(event, details = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), event, dryRun: DRY_RUN, details }));
}

function fail(event, details = {}) {
  console.error(JSON.stringify({ timestamp: new Date().toISOString(), event, level: 'error', details }));
  process.exitCode = 1;
}

// A timestamp that sorts chronologically as a plain string and survives every
// filesystem: 2026-09-06T07-41-12Z.
function runStamp() {
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');
}

function run(command, args, { env } = {}) {
  return new Promise((resolve, reject) => {
    // No shell: the connection string and paths go straight to the process,
    // so nothing in them can be reinterpreted as shell syntax.
    const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'inherit', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      reject(error.code === 'ENOENT'
        ? new Error(`${command} not found. Install the PostgreSQL client tools.`)
        : error);
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}: ${stderr.trim()}`));
    });
  });
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function directoryExists(dir) {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

async function countUploads(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).length;
  } catch {
    return 0;
  }
}

async function main() {
  const stamp = runStamp();
  const target = path.join(OUT_ROOT, stamp);
  const hasUploads = !DB_ONLY && await directoryExists(UPLOADS_DIR);

  log('backup.started', {
    target,
    uploads: hasUploads ? UPLOADS_DIR : null,
    uploadCount: hasUploads ? await countUploads(UPLOADS_DIR) : 0,
  });

  if (DRY_RUN) {
    log('backup.dry_run_complete', {
      wouldWrite: [
        path.join(target, 'database.dump'),
        hasUploads ? path.join(target, 'uploads.tar.gz') : null,
        path.join(target, 'manifest.json'),
      ].filter(Boolean),
    });
    return;
  }

  await mkdir(target, { recursive: true });

  const dumpPath = path.join(target, 'database.dump');
  // Custom format (-Fc): compressed, and pg_restore can inspect it before
  // applying, which a plain SQL dump does not allow.
  await run('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--file', dumpPath, DATABASE_URL]);
  const dumpSize = (await stat(dumpPath)).size;
  log('backup.database_written', { path: dumpPath, bytes: dumpSize });

  const artefacts = {
    'database.dump': { bytes: dumpSize, sha256: await sha256(dumpPath) },
  };

  if (hasUploads) {
    const uploadsPath = path.join(target, 'uploads.tar.gz');
    // -C so the archive holds relative paths and can be restored to a
    // different location than it came from.
    await run('tar', ['-czf', uploadsPath, '-C', path.dirname(UPLOADS_DIR), path.basename(UPLOADS_DIR)]);
    const uploadsSize = (await stat(uploadsPath)).size;
    artefacts['uploads.tar.gz'] = { bytes: uploadsSize, sha256: await sha256(uploadsPath) };
    log('backup.uploads_written', { path: uploadsPath, bytes: uploadsSize });
  }

  const manifest = {
    createdAt: new Date().toISOString(),
    service: 'transkription-webapp',
    // Which database this came from, without the credentials in it.
    database: DATABASE_URL.replace(/\/\/[^@]*@/, '//***@'),
    node: process.version,
    // Encrypted provider credentials in the dump are useless without the key
    // that encrypted them. Recording only whether one was set — never the key
    // — lets a restore warn about a mismatch instead of failing mysteriously
    // later, when someone opens the integrations page and every key is
    // unreadable.
    secretEncryptionKeyConfigured: Boolean(process.env.SECRET_ENCRYPTION_KEY),
    includesUploads: hasUploads,
    artefacts,
  };
  const manifestPath = path.join(target, 'manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  log('backup.completed', {
    target,
    totalBytes: Object.values(artefacts).reduce((sum, entry) => sum + entry.bytes, 0),
    manifest: manifestPath,
  });
}

main().catch((error) => {
  fail('backup.failed', { message: error.message });
});
