// Deleting a document used to be a hard DELETE plus unlink(), so a mis-clicked
// bulk action destroyed the audio with no way back. It is a trash now, and the
// three things worth proving against a real database are: a deleted document
// disappears from the library but survives, restoring returns it, and the
// purge — the only step that still destroys anything — does its job on
// schedule and not before.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  setupDbTestEnvironment,
  registerSkippedSuite,
  createTestOrganization,
  createTestUser,
  addOrganizationMember,
  cleanupFixtures,
} from './helpers.mjs';

const SUITE = 'document trash (PostgreSQL, soft delete + purge)';
const env = await setupDbTestEnvironment();

if (env.skip) {
  registerSkippedSuite(SUITE, env.skip);
} else {
  const { pool } = env;
  const created = { organizationIds: [], userIds: [] };

  let organizationId;
  let userId;

  before(async () => {
    organizationId = await createTestOrganization(pool, { name: 'Trash Test Org' });
    userId = await createTestUser(pool);
    created.organizationIds.push(organizationId);
    created.userIds.push(userId);
    await addOrganizationMember(pool, organizationId, userId);
  });

  after(async () => {
    await cleanupFixtures(pool, created);
    await pool.end();
  });

  // Mirrors what pages/api/upload.js produces: a transcription with a file on
  // disk, and the library row that points at it.
  async function createDocumentWithFile({ deletedAt = null } = {}) {
    const dir = await mkdtemp(path.join(tmpdir(), 'gt-trash-'));
    const filePath = path.join(dir, 'recording.mp3');
    await writeFile(filePath, 'audio-bytes');

    const transcription = await pool.query(
      `INSERT INTO transcriptions (user_id, organization_id, status, original_name, filename, file_path)
         VALUES ($1, $2, 'completed', 'recording.mp3', 'recording.mp3', $3) RETURNING id`,
      [userId, organizationId, filePath],
    );
    const transcriptionId = Number(transcription.rows[0].id);

    const document = await pool.query(
      `INSERT INTO documents
         (organization_id, owner_user_id, visibility, source_type, title, status, transcription_id, deleted_at)
       VALUES ($1, $2, 'workspace', 'audio_transcription', 'Recording', 'ready', $3, $4)
       RETURNING id`,
      [organizationId, userId, transcriptionId, deletedAt],
    );
    return { documentId: Number(document.rows[0].id), transcriptionId, filePath };
  }

  // The library's own filter, as pages/api/documents/index.js builds it.
  async function listLibrary({ trash = false } = {}) {
    const result = await pool.query(
      `SELECT d.id FROM documents d
        WHERE d.organization_id = $1
          AND d.deleted_at IS ${trash ? 'NOT NULL' : 'NULL'}`,
      [organizationId],
    );
    return result.rows.map((row) => Number(row.id));
  }

  async function fileExists(filePath) {
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  function runRetention(env_ = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn('node', ['scripts/apply-retention-policy.js'], {
        cwd: path.resolve(new URL('../..', import.meta.url).pathname),
        env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL, ...env_ },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      child.stdout.on('data', (chunk) => { out += chunk.toString(); });
      child.stderr.on('data', (chunk) => { out += chunk.toString(); });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, out }));
    });
  }

  test('deleting hides the document from the library without destroying anything', async () => {
    const { documentId, transcriptionId, filePath } = await createDocumentWithFile();

    assert.ok((await listLibrary()).includes(documentId), 'precondition: visible before deletion');

    await pool.query(
      `UPDATE documents SET deleted_at = NOW(), updated_at = NOW()
        WHERE id = ANY($1::int[]) AND organization_id = $2 AND deleted_at IS NULL`,
      [[documentId], organizationId],
    );

    assert.ok(!(await listLibrary()).includes(documentId), 'still listed in the library');
    assert.ok((await listLibrary({ trash: true })).includes(documentId), 'not in the trash view');

    // The two things the old hard delete destroyed immediately.
    const transcription = await pool.query('SELECT id FROM transcriptions WHERE id = $1', [transcriptionId]);
    assert.equal(transcription.rowCount, 1, 'transcription was deleted');
    assert.equal(await fileExists(filePath), true, 'audio file was unlinked');
  });

  test('restoring returns the document to the library', async () => {
    const { documentId } = await createDocumentWithFile({ deletedAt: new Date().toISOString() });

    const restored = await pool.query(
      `UPDATE documents SET deleted_at = NULL, updated_at = NOW()
        WHERE id = ANY($1::int[]) AND organization_id = $2 AND deleted_at IS NOT NULL
      RETURNING id`,
      [[documentId], organizationId],
    );

    assert.equal(restored.rowCount, 1);
    assert.ok((await listLibrary()).includes(documentId), 'restored document is not back in the library');
  });

  test('a second delete of an already-trashed document reports no change', async () => {
    // recordOutcome in the bulk endpoint reads RETURNING to decide success, so
    // the guard has to be in the statement rather than in the caller.
    const { documentId } = await createDocumentWithFile({ deletedAt: new Date().toISOString() });

    const again = await pool.query(
      `UPDATE documents SET deleted_at = NOW()
        WHERE id = ANY($1::int[]) AND organization_id = $2 AND deleted_at IS NULL
      RETURNING id`,
      [[documentId], organizationId],
    );
    assert.equal(again.rowCount, 0);
  });

  test('the purge spares a fresh deletion and destroys an expired one', async () => {
    const fresh = await createDocumentWithFile({ deletedAt: new Date().toISOString() });
    const old = await createDocumentWithFile({
      deletedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
    });

    // Default grace period is 30 days, so only `old` is past it.
    const { code, out } = await runRetention();
    assert.equal(code, 0, `retention script failed: ${out}`);

    const survived = await pool.query('SELECT id FROM documents WHERE id = $1', [fresh.documentId]);
    assert.equal(survived.rowCount, 1, 'a recently deleted document must stay recoverable');
    assert.equal(await fileExists(fresh.filePath), true, 'its audio must stay on disk');

    const purged = await pool.query('SELECT id FROM documents WHERE id = $1', [old.documentId]);
    assert.equal(purged.rowCount, 0, 'expired document was not purged');
    const purgedTranscription = await pool.query('SELECT id FROM transcriptions WHERE id = $1', [old.transcriptionId]);
    assert.equal(purgedTranscription.rowCount, 0, 'its transcription should have gone with it');
  });

  test('the purge runs even when no retention policy is configured', async () => {
    // The trash is the second half of the delete button, not an opt-in policy;
    // if it only ran alongside a configured policy, a default deployment would
    // never free the disk again.
    const { out } = await runRetention();
    assert.match(out, /retention\.trash\.(applied|dry_run)/, 'no trash pass in the output');
  });
}
