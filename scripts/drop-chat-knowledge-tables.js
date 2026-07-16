/**
 * Operator-run cleanup: drop the DB tables left behind by the removal of
 * Chat, Knowledge Bases (RAG index) and Tasks (see
 * openspec/changes/remove-chat-knowledge-tasks/).
 *
 * `lib/db-init.js` stopped creating these tables for fresh installs, but
 * existing deployments still carry them — they are NOT dropped
 * automatically by app code. This script is the deliberate, operator-run
 * follow-up after a deprecation window.
 *
 *   node scripts/drop-chat-knowledge-tables.js            # dry-run (default): prints what would be dropped
 *   node scripts/drop-chat-knowledge-tables.js --apply    # actually drops the tables
 *
 * Tables dropped (children before parents; CASCADE as a safety net for any
 * FK this list didn't anticipate):
 *   document_chunk_embeddings, document_chunks, document_index_jobs,
 *   tasks, chat_context_items, chat_messages, chat_conversations,
 *   knowledge_items, knowledge_directories, knowledge_bases
 *
 * Audit logging: this script intentionally does NOT import
 * `lib/audit-log.js` — every other script in this directory
 * (apply-retention-policy.js, migrate-api-keys.js, ...) talks to Postgres
 * directly via `pg` rather than importing the app's ESM `lib/*` modules,
 * since these scripts run standalone via plain `node scripts/x.js`
 * outside the Next.js/ESM build. Following that convention, this script
 * writes an `audit_log` row itself (mirroring the shape written by
 * `logAuditEvent`) with `user_id = NULL` / `organization_id = NULL` —
 * there is no session to attribute the run to. If the `audit_log` table
 * itself no longer exists in some future cleanup, the insert is
 * best-effort and failures are logged to the console instead of aborting
 * the run.
 */

const { Pool } = require('pg');

const DEFAULT_DATABASE_URL = 'postgresql://transkription:transkription@localhost:5432/transkription';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
});

const APPLY = process.argv.includes('--apply');

// Children first, then parents. DROP ... CASCADE is used as a belt-and-
// braces measure in case a FK exists that this list didn't anticipate —
// every table here is exclusively part of the removed chat/knowledge/RAG
// feature set, so cascading is safe.
const TABLES = [
  'document_chunk_embeddings',
  'tasks',
  'chat_context_items',
  'chat_messages',
  'knowledge_items',
  'knowledge_directories',
  'document_chunks',
  'document_index_jobs',
  'chat_conversations',
  'knowledge_bases',
];

function log(event, details = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), event, apply: APPLY, details }));
}

async function tableExists(client, tableName) {
  const result = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [tableName],
  );
  return result.rows.length > 0;
}

async function rowCount(client, tableName) {
  try {
    const result = await client.query(`SELECT COUNT(*)::int AS n FROM "${tableName}"`);
    return result.rows[0]?.n ?? 0;
  } catch {
    return null;
  }
}

async function writeAuditEvent(client, summary) {
  try {
    await client.query(
      `INSERT INTO audit_log (user_id, organization_id, action, target_type, target_id, severity, metadata)
       VALUES (NULL, NULL, $1, $2, $3, $4, $5::jsonb)`,
      [
        'system.drop_chat_knowledge_tables',
        'system',
        'drop-chat-knowledge-tables',
        'warn',
        JSON.stringify(summary),
      ],
    );
  } catch (error) {
    log('audit_log.write_failed', { error: error.message });
  }
}

async function main() {
  const client = await pool.connect();
  const summary = { dropped: [], skipped: [] };
  try {
    for (const table of TABLES) {
      const exists = await tableExists(client, table);
      if (!exists) {
        log('table.absent', { table });
        summary.skipped.push({ table, reason: 'absent' });
        continue;
      }

      const count = await rowCount(client, table);
      if (!APPLY) {
        log('table.would_drop', { table, rowCount: count });
        summary.skipped.push({ table, reason: 'dry_run', rowCount: count });
        continue;
      }

      await client.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
      log('table.dropped', { table, rowCount: count });
      summary.dropped.push({ table, rowCount: count });
    }

    if (APPLY) {
      await writeAuditEvent(client, summary);
    }

    log('run.completed', summary);
  } finally {
    client.release();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
