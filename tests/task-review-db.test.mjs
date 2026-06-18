import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL || '';

async function withTempTasks(fn) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const schema = `test_tasks_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`CREATE TABLE tasks (id BIGSERIAL PRIMARY KEY, organization_id BIGINT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'proposed', priority TEXT NOT NULL DEFAULT 'medium', updated_at TIMESTAMPTZ DEFAULT NOW())`);
    await fn(client);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await client.end();
  }
}

test('task review DB smoke accepts proposed task', { skip: !databaseUrl }, async () => {
  await withTempTasks(async (client) => {
    const inserted = await client.query("INSERT INTO tasks (organization_id, title) VALUES (1, 'Vertrag pruefen') RETURNING id");
    const id = inserted.rows[0].id;
    const updated = await client.query("UPDATE tasks SET status = 'open', updated_at = NOW() WHERE id = $1 AND organization_id = $2 RETURNING status", [id, 1]);
    assert.equal(updated.rows[0].status, 'open');
  });
});

test('task review DB smoke completes and dismisses tasks', { skip: !databaseUrl }, async () => {
  await withTempTasks(async (client) => {
    const open = await client.query("INSERT INTO tasks (organization_id, title, status) VALUES (1, 'Offen', 'open') RETURNING id");
    const proposed = await client.query("INSERT INTO tasks (organization_id, title) VALUES (1, 'Vorschlag') RETURNING id");
    const done = await client.query("UPDATE tasks SET status = 'done' WHERE id = $1 AND organization_id = 1 RETURNING status", [open.rows[0].id]);
    const dismissed = await client.query("UPDATE tasks SET status = 'dismissed' WHERE id = $1 AND organization_id = 1 RETURNING status", [proposed.rows[0].id]);
    assert.equal(done.rows[0].status, 'done');
    assert.equal(dismissed.rows[0].status, 'dismissed');
  });
});
