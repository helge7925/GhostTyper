import test from 'node:test';
import crypto from 'node:crypto';

/**
 * Shared setup for the DB-backed suites under tests/db/.
 *
 * Every other test in this repo injects a `queryFn` and never touches a
 * real database. These suites are the deliberate exception: proving row-lock
 * semantics (`SELECT ... FOR UPDATE` on the organization-period row) and
 * outbox delivery semantics needs a real PostgreSQL 16, not a mock. See
 * docs/testing.md ("Database-backed tests") for how to start a throwaway
 * instance and point TEST_DATABASE_URL at it.
 *
 * Gating rules (do not relax these):
 *  - TEST_DATABASE_URL must be set. The production DATABASE_URL is never
 *    read directly here, so a shell that only has DATABASE_URL exported
 *    causes a clean skip instead of accidentally running against it.
 *  - The database name in TEST_DATABASE_URL must look like a test database
 *    (its name must contain "test", case-insensitive). These suites CREATE
 *    and DELETE organizations/users freely; refuse to run rather than risk
 *    pointing that at anything real.
 */

function looksLikeTestDatabase(connectionString) {
  try {
    const url = new URL(connectionString);
    const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''));
    return /test/i.test(dbName);
  } catch {
    return false;
  }
}

/** Registers a single no-op test that reports as skipped with `reason`. */
export function registerSkippedSuite(name, reason) {
  test(name, { skip: reason }, () => {});
}

/**
 * Points process.env.DATABASE_URL at TEST_DATABASE_URL and boots the schema
 * via lib/db-init.js — the same init path the app itself uses, so this never
 * duplicates DDL. Idempotent: safe to call once per test file even though
 * several DB test files run in the same `npm run test:db` invocation
 * (each runs in the node:test child process for that file).
 *
 * Returns `{ skip: reason }` when the suite should skip cleanly (env var
 * unset, cannot connect, or pg_trgm unavailable). Returns `{ pool }` when
 * ready. Throws — deliberately failing the run rather than skipping — when
 * TEST_DATABASE_URL is set but its database name does not look like a test
 * database, since that is a misconfiguration and these tests are destructive.
 */
export async function setupDbTestEnvironment() {
  const testUrl = process.env.TEST_DATABASE_URL || null;
  if (!testUrl) {
    return {
      skip: 'TEST_DATABASE_URL is not set; DB-backed suite skipped. '
        + 'See docs/testing.md ("Database-backed tests") to start a throwaway Postgres 16 and run npm run test:db.',
    };
  }
  if (!looksLikeTestDatabase(testUrl)) {
    throw new Error(
      'Refusing to run DB-backed tests: the database name in TEST_DATABASE_URL does not look like a '
      + 'test database (expected the name to contain "test"). These suites create and destroy data — '
      + 'point TEST_DATABASE_URL at a disposable database, never at DATABASE_URL / production.',
    );
  }
  process.env.DATABASE_URL = testUrl;

  const { default: pool } = await import('../../lib/db.js');

  try {
    await pool.query('SELECT 1');
  } catch (error) {
    await pool.end().catch(() => {});
    return {
      skip: `Could not connect to TEST_DATABASE_URL (${error.message}). `
        + 'Start a throwaway Postgres 16 — see docs/testing.md.',
    };
  }

  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  } catch (error) {
    await pool.end().catch(() => {});
    return {
      skip: `pg_trgm extension is unavailable on TEST_DATABASE_URL (${error.message}). `
        + 'The official postgres:16 image bundles it; a bare-metal install may need the postgresql-contrib package.',
    };
  }

  const { initDatabase } = await import('../../lib/db-init.js');
  await initDatabase();

  return { pool };
}

// ---- Fixtures ----------------------------------------------------------

let uniqueCounter = 0;
function unique(prefix) {
  uniqueCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${uniqueCounter}-${crypto.randomBytes(3).toString('hex')}`;
}

export async function createTestOrganization(pool, { name = 'DB Test Org', plan = 'free' } = {}) {
  const slug = unique('db-test-org');
  const result = await pool.query(
    `INSERT INTO organizations (name, slug, plan) VALUES ($1, $2, $3) RETURNING id`,
    [name, slug, plan],
  );
  return Number(result.rows[0].id);
}

// Obvious dummy value — never a real credential or password.
const DUMMY_PASSWORD_HASH = 'not-a-real-hash:db-test-fixture';

export async function createTestUser(pool, { email = null, name = 'DB Test User' } = {}) {
  const finalEmail = email || `${unique('dbtest')}@example.invalid`;
  const result = await pool.query(
    `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id`,
    [finalEmail, name, DUMMY_PASSWORD_HASH],
  );
  return Number(result.rows[0].id);
}

export async function addOrganizationMember(pool, organizationId, userId, role = 'member') {
  await pool.query(
    `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [organizationId, userId, role],
  );
}

export async function setWorkspaceLimit(pool, organizationId, costLimitCents) {
  await pool.query(
    `INSERT INTO organization_settings (organization_id, cost_limit_cents)
       VALUES ($1, $2)
     ON CONFLICT (organization_id) DO UPDATE SET cost_limit_cents = EXCLUDED.cost_limit_cents`,
    [organizationId, costLimitCents],
  );
}

export async function setMemberLimit(pool, organizationId, userId, monthlyLimitMicros) {
  await pool.query(
    `INSERT INTO organization_member_budgets (organization_id, user_id, monthly_limit_micros)
       VALUES ($1, $2, $3)
     ON CONFLICT (organization_id, user_id) DO UPDATE SET monthly_limit_micros = EXCLUDED.monthly_limit_micros`,
    [organizationId, userId, monthlyLimitMicros],
  );
}

export async function createTestTranscription(pool, organizationId, userId, { status = 'processing' } = {}) {
  const result = await pool.query(
    `INSERT INTO transcriptions (user_id, organization_id, status, original_name)
       VALUES ($1, $2, $3, 'db-test-fixture.wav') RETURNING id`,
    [userId, organizationId, status],
  );
  return Number(result.rows[0].id);
}

/**
 * Deletes everything scoped to the given organizations (cascades through
 * budget_reservations, organization_budget_periods, budget_stop_outbox,
 * usage_log, transcriptions, organization_members, organization_settings,
 * organization_member_budgets, organization_integrations — see the FKs in
 * lib/db-init.js) and then the users created for the test. Call from an
 * `after` hook so suites can run repeatedly and in any order.
 */
export async function cleanupFixtures(pool, { organizationIds = [], userIds = [] } = {}) {
  if (organizationIds.length) {
    await pool.query(`DELETE FROM organizations WHERE id = ANY($1::bigint[])`, [organizationIds]);
  }
  if (userIds.length) {
    await pool.query(`DELETE FROM users WHERE id = ANY($1::integer[])`, [userIds]);
  }
}

export function futureIso(minutes = 60) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

/**
 * Mirrors the private `periodStart()` in lib/budget-service.js (UTC-based
 * first-of-month) so tests can compute the same period key without
 * depending on the server session's timezone for a SQL-side date_trunc.
 */
export function currentPeriodStart(at = new Date()) {
  const date = new Date(at);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}
