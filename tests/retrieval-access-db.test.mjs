import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL || '';

async function withTempSchema(fn) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const schema = `test_access_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`
      CREATE TABLE documents (
        id BIGINT PRIMARY KEY,
        organization_id BIGINT NOT NULL,
        owner_user_id INTEGER NOT NULL,
        visibility TEXT NOT NULL
      );
      CREATE TABLE knowledge_items (
        knowledge_base_id BIGINT NOT NULL,
        organization_id BIGINT NOT NULL,
        document_id BIGINT NOT NULL,
        retrieval_mode TEXT NOT NULL
      );
    `);
    await fn(client);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await client.end();
  }
}

test('knowledge item insert scope rejects private documents at DB query level', { skip: !databaseUrl }, async () => {
  await withTempSchema(async (client) => {
    await client.query("INSERT INTO documents VALUES (1, 10, 7, 'workspace'), (2, 10, 7, 'private')");
    const workspace = await client.query(
      "SELECT id FROM documents WHERE id = $1 AND organization_id = $2 AND visibility = 'workspace'",
      [1, 10],
    );
    const privateDoc = await client.query(
      "SELECT id FROM documents WHERE id = $1 AND organization_id = $2 AND visibility = 'workspace'",
      [2, 10],
    );
    assert.equal(workspace.rowCount, 1);
    assert.equal(privateDoc.rowCount, 0);
  });
});

test('knowledge retrieval scope filters private documents owned by another user', { skip: !databaseUrl }, async () => {
  await withTempSchema(async (client) => {
    await client.query("INSERT INTO documents VALUES (1, 10, 7, 'workspace'), (2, 10, 99, 'private'), (3, 10, 7, 'private')");
    await client.query("INSERT INTO knowledge_items VALUES (5, 10, 1, 'focused'), (5, 10, 2, 'focused'), (5, 10, 3, 'full_context')");
    const result = await client.query(
      `SELECT ki.document_id, ki.retrieval_mode
         FROM knowledge_items ki
         JOIN documents d ON d.id = ki.document_id AND d.organization_id = ki.organization_id
        WHERE ki.knowledge_base_id = $1
          AND ki.organization_id = $2
          AND (d.visibility = 'workspace' OR d.owner_user_id = $3)
        ORDER BY ki.document_id`,
      [5, 10, 7],
    );
    assert.deepEqual(result.rows.map((row) => Number(row.document_id)), [1, 3]);
  });
});
