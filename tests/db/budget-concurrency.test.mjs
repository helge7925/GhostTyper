// DB-backed suite (real PostgreSQL 16 — see tests/db/helpers.mjs and
// docs/testing.md). Proves the row-lock semantics behind reserveSpend's
// `SELECT ... FOR UPDATE` on the organization-period row: parallel users
// racing the same workspace budget can never over-reserve it. A mocked
// queryFn cannot prove this — there is no lock to race against — which is
// why this lives here instead of alongside the pure-function budget tests.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupDbTestEnvironment,
  registerSkippedSuite,
  createTestOrganization,
  createTestUser,
  addOrganizationMember,
  setWorkspaceLimit,
  cleanupFixtures,
  futureIso,
  currentPeriodStart,
} from './helpers.mjs';

const SUITE = 'budget concurrency (PostgreSQL, real row locks)';
const env = await setupDbTestEnvironment();

if (env.skip) {
  registerSkippedSuite(SUITE, env.skip);
} else {
  const { pool } = env;
  const { reserveSpend, BudgetExceededError } = await import('../../lib/budget-service.js');

  let organizationId;
  const userIds = [];

  before(async () => {
    organizationId = await createTestOrganization(pool, { name: 'Concurrency Test Org' });
    // Workspace limit: 300 cents = 3,000,000 micros. Five users each try to
    // reserve 1,000,000 micros at the same instant; only 3 can fit.
    await setWorkspaceLimit(pool, organizationId, 300);
    for (let i = 0; i < 5; i += 1) {
      const userId = await createTestUser(pool);
      await addOrganizationMember(pool, organizationId, userId);
      userIds.push(userId);
    }
  });

  after(async () => {
    await cleanupFixtures(pool, { organizationIds: [organizationId], userIds });
    await pool.end();
  });

  test('parallel users racing the same workspace budget cannot over-reserve it', async () => {
    const amountMicros = 1_000_000;
    const expiresAt = futureIso(60);

    // Genuinely parallel: each reserveSpend call pulls its own client from
    // the pool and runs its own transaction (BEGIN; SELECT ... FOR UPDATE on
    // organization_budget_periods; ...; COMMIT). Promise.all races all five
    // against each other instead of awaiting them one at a time — sequential
    // awaits would never touch the lock contention this is supposed to prove.
    const results = await Promise.allSettled(userIds.map((userId) =>
      reserveSpend({
        idempotencyKey: `concurrency-race:${organizationId}:${userId}`,
        organizationId,
        userId,
        operation: 'translation',
        amountMicros,
        expiresAt,
      })));

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    assert.equal(fulfilled.length, 3, `expected exactly 3 of 5 concurrent reservations to succeed, got ${fulfilled.length}`);
    assert.equal(rejected.length, 2);
    for (const r of rejected) {
      assert.ok(r.reason instanceof BudgetExceededError, `expected BudgetExceededError, got ${r.reason}`);
      assert.equal(r.reason.scope, 'workspace');
    }

    // Invariant: total reserved never exceeds the workspace limit, no matter
    // how the five concurrent transactions interleaved.
    const period = await pool.query(
      `SELECT reserved_micros FROM organization_budget_periods
        WHERE organization_id = $1 AND period_start = $2::date`,
      [organizationId, currentPeriodStart()],
    );
    assert.equal(period.rowCount, 1);
    assert.equal(Number(period.rows[0].reserved_micros), 3_000_000);

    const sum = await pool.query(
      `SELECT COALESCE(SUM(amount_micros), 0)::bigint AS total
         FROM budget_reservations
        WHERE organization_id = $1 AND state = 'reserved'`,
      [organizationId],
    );
    assert.equal(Number(sum.rows[0].total), 3_000_000);
    assert.ok(Number(sum.rows[0].total) <= 3_000_000, 'reserved total must never exceed the workspace limit');
  });

  test('a second, differently-sized race (10 requests, room for 4) still holds the invariant exactly', async () => {
    const orgId = await createTestOrganization(pool, { name: 'Concurrency Test Org 2' });
    const localUserIds = [];
    try {
      await setWorkspaceLimit(pool, orgId, 100); // 1,000,000 micros
      for (let i = 0; i < 10; i += 1) {
        const userId = await createTestUser(pool);
        await addOrganizationMember(pool, orgId, userId);
        localUserIds.push(userId);
      }
      const expiresAt = futureIso(60);
      const results = await Promise.allSettled(localUserIds.map((userId) =>
        reserveSpend({
          idempotencyKey: `concurrency-race-2:${orgId}:${userId}`,
          organizationId: orgId,
          userId,
          operation: 'translation',
          amountMicros: 250_000,
          expiresAt,
        })));
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      assert.equal(fulfilled.length, 4, `expected exactly 4 of 10 concurrent reservations to succeed, got ${fulfilled.length}`);

      const period = await pool.query(
        `SELECT reserved_micros FROM organization_budget_periods
          WHERE organization_id = $1 AND period_start = $2::date`,
        [orgId, currentPeriodStart()],
      );
      assert.equal(Number(period.rows[0].reserved_micros), 1_000_000);
    } finally {
      await cleanupFixtures(pool, { organizationIds: [orgId], userIds: localUserIds });
    }
  });

  test('idempotency key replay under concurrency returns one reservation, not a duplicate', async () => {
    const orgId = await createTestOrganization(pool, { name: 'Concurrency Idempotency Org' });
    const userId = await createTestUser(pool);
    try {
      await addOrganizationMember(pool, orgId, userId);
      await setWorkspaceLimit(pool, orgId, 1000);
      const expiresAt = futureIso(60);
      const key = `concurrency-idempotent:${orgId}:${userId}`;

      // Five concurrent callers racing the exact same idempotency key — e.g.
      // a retried client request. Exactly one row must ever be created.
      const results = await Promise.allSettled(Array.from({ length: 5 }, () =>
        reserveSpend({
          idempotencyKey: key,
          organizationId: orgId,
          userId,
          operation: 'translation',
          amountMicros: 500_000,
          expiresAt,
        })));
      const fulfilled = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
      assert.equal(fulfilled.length, 5, 'idempotent replays should all resolve, not fail');
      const distinctIds = new Set(fulfilled.map((row) => row.id));
      assert.equal(distinctIds.size, 1, 'all concurrent replays must resolve to the same reservation row');

      const count = await pool.query(
        `SELECT COUNT(*)::int AS n FROM budget_reservations WHERE organization_id = $1 AND idempotency_key = $2`,
        [orgId, key],
      );
      assert.equal(count.rows[0].n, 1);
    } finally {
      await cleanupFixtures(pool, { organizationIds: [orgId], userIds: [userId] });
    }
  });
}
