#!/usr/bin/env node
/**
 * Phase 4a backfill — assign every existing user-scoped row to a personal
 * organisation. Idempotent: re-running is a no-op.
 *
 *   node scripts/migrate-to-organizations.mjs            # dry-run
 *   node scripts/migrate-to-organizations.mjs --apply    # write changes
 *   node scripts/migrate-to-organizations.mjs --enforce  # AFTER all API
 *                                                          endpoints have
 *                                                          been migrated:
 *                                                          flip organization_id
 *                                                          columns to NOT NULL.
 *
 * Steps (in order):
 *   1. For every user without a personal org, INSERT one and add them as owner.
 *   2. For every user-scoped table (transcriptions, templates, folders, ...),
 *      UPDATE rows with NULL organization_id to point at the user's personal org.
 *   3. With --enforce: ALTER COLUMN organization_id SET NOT NULL on those tables.
 *
 * Safe to run while the app is live; queries are bounded and use indexed
 * lookups. The --enforce step is destructive (rejects future inserts with
 * NULL organization_id) — only run it once Phase 4b ships.
 */
import process from 'node:process';
import pkg from 'pg';
const { Client } = pkg;

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const ENFORCE = args.has('--enforce');
const VERBOSE = args.has('--verbose');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Aborting.');
  process.exit(1);
}

// (table, fk_column) tuples — fk_column is the user-foreign-key the row's
// owner can be looked up through.
const SCOPED_TABLES = [
  { table: 'transcriptions',      fk: 'user_id' },
  { table: 'templates',            fk: 'user_id' },
  { table: 'template_categories',  fk: 'user_id' },
  { table: 'folders',              fk: 'user_id' },
  { table: 'usage_log',            fk: 'user_id' },
  { table: 'api_keys',             fk: 'user_id' },
  { table: 'audit_log',            fk: 'user_id' },
  { table: 'transcription_events', fk: 'user_id' },
];

function log(...parts) {
  if (VERBOSE) console.log(...parts);
}

function slugForUser(user) {
  // Stable, scoped slug: "personal-<id>". The personal org's display name is
  // the user's email so it shows up sensibly in the workspace switcher.
  return `personal-${user.id}`;
}

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  console.log(`\nConnected. Mode: ${APPLY ? (ENFORCE ? 'APPLY + ENFORCE' : 'APPLY') : 'DRY-RUN'}\n`);

  try {
    if (APPLY) await client.query('BEGIN');

    // 1) Pre-flight: count users + existing personal orgs.
    const usersRes = await client.query('SELECT id, email, name FROM users ORDER BY id');
    const users = usersRes.rows;
    console.log(`Users:                 ${users.length}`);

    const orgsBefore = await client.query(
      'SELECT count(*)::int AS n FROM organizations WHERE is_personal = true',
    );
    console.log(`Existing personal orgs: ${orgsBefore.rows[0].n}`);

    // 2) Create one personal org per missing user.
    let createdOrgs = 0;
    let createdMemberships = 0;

    for (const user of users) {
      const slug = slugForUser(user);
      const existing = await client.query(
        'SELECT id FROM organizations WHERE slug = $1',
        [slug],
      );
      let orgId = existing.rows[0]?.id;

      if (!orgId) {
        if (APPLY) {
          const inserted = await client.query(
            `INSERT INTO organizations (name, slug, plan, is_personal)
             VALUES ($1, $2, 'free', true)
             RETURNING id`,
            [user.email || `Personal #${user.id}`, slug],
          );
          orgId = inserted.rows[0].id;
        }
        createdOrgs += 1;
        log(`  + org ${slug} (user ${user.id})`);
      }

      // Membership (owner)
      if (orgId) {
        const memberExists = await client.query(
          'SELECT 1 FROM organization_members WHERE organization_id = $1 AND user_id = $2',
          [orgId, user.id],
        );
        if (memberExists.rows.length === 0) {
          if (APPLY) {
            await client.query(
              `INSERT INTO organization_members (organization_id, user_id, role)
               VALUES ($1, $2, 'owner')`,
              [orgId, user.id],
            );
          }
          createdMemberships += 1;
          log(`  + member user=${user.id} org=${orgId}`);
        }
      }
    }

    console.log(`Personal orgs to create:    ${createdOrgs}`);
    console.log(`Owner memberships to create: ${createdMemberships}`);

    // 3) Backfill organization_id on every user-scoped table.
    console.log('\nBackfilling organization_id…');
    const updateTotals = {};
    for (const { table, fk } of SCOPED_TABLES) {
      // We resolve the user's personal org via the membership (role=owner,
      // is_personal=true). This is robust even if a user has been added to
      // additional shared orgs since (the personal org stays unique).
      const sql = `
        UPDATE ${table} t
        SET organization_id = o.id
        FROM organizations o
        WHERE t.organization_id IS NULL
          AND o.is_personal = true
          AND o.slug = 'personal-' || t.${fk}::text
      `;
      if (APPLY) {
        const res = await client.query(sql);
        updateTotals[table] = res.rowCount;
        console.log(`  ${table.padEnd(22)} ${res.rowCount} rows updated`);
      } else {
        // dry-run: count what *would* be updated
        const probe = await client.query(`
          SELECT count(*)::int AS n
          FROM ${table} t
          LEFT JOIN organizations o
            ON o.is_personal = true
            AND o.slug = 'personal-' || t.${fk}::text
          WHERE t.organization_id IS NULL
            AND o.id IS NOT NULL
        `);
        updateTotals[table] = probe.rows[0].n;
        console.log(`  ${table.padEnd(22)} ${probe.rows[0].n} rows would be updated`);
      }
    }

    // 4) Optionally flip NOT NULL constraints (Phase 4b cutover step).
    if (ENFORCE) {
      console.log('\nEnforcing NOT NULL constraints…');
      const NOT_NULL_TABLES = [
        'transcriptions',
        'templates',
        'template_categories',
        'folders',
        'usage_log',
        'api_keys',
        'transcription_events',
        // audit_log stays NULLABLE: system events without a user (e.g. cron
        // jobs) may still have no organisation context.
      ];
      for (const table of NOT_NULL_TABLES) {
        const stillNull = await client.query(
          `SELECT count(*)::int AS n FROM ${table} WHERE organization_id IS NULL`,
        );
        if (stillNull.rows[0].n > 0) {
          throw new Error(
            `Cannot enforce NOT NULL on ${table}: ${stillNull.rows[0].n} rows still NULL.`,
          );
        }
        if (APPLY) {
          await client.query(`ALTER TABLE ${table} ALTER COLUMN organization_id SET NOT NULL`);
          console.log(`  ${table.padEnd(22)} NOT NULL ✓`);
        } else {
          console.log(`  ${table.padEnd(22)} would set NOT NULL`);
        }
      }
    }

    if (APPLY) await client.query('COMMIT');
    console.log(`\n${APPLY ? 'Done.' : 'Dry-run only — re-run with --apply to write.'}`);
  } catch (error) {
    if (APPLY) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    }
    console.error('\nMigration failed:', error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
