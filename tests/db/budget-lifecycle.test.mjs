// DB-backed suite (real PostgreSQL 16 — see tests/db/helpers.mjs and
// docs/testing.md). Covers the areas of Phase 3/4 of
// openspec/changes/deferred-translation-pdf-budget-controls that are only
// meaningfully testable against a real database: threshold crossing into a
// budget stop, idempotent/repeated budget_stop_outbox delivery under real
// concurrency (FOR UPDATE SKIP LOCKED), concurrent reserve/commit streams
// reconciling without lost updates, and restart/reconcile behavior — in
// particular that workers never revive an already budget-stopped job.
//
// Abort propagation via AbortSignal is deliberately NOT re-tested here: it
// does not touch the database (registerBudgetExecution/
// abortBudgetExecutionsForScope/composeAbortSignals/startAbortPolling are
// pure in-process signal plumbing) and is already covered by
// tests/budget-runtime.test.mjs. Duplicating it against a real DB would add
// runtime without adding coverage.
//
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupDbTestEnvironment,
  registerSkippedSuite,
  createTestOrganization,
  createTestUser,
  addOrganizationMember,
  setWorkspaceLimit,
  setMemberLimit,
  createTestTranscription,
  cleanupFixtures,
  futureIso,
  currentPeriodStart,
} from './helpers.mjs';

const SUITE = 'budget lifecycle (PostgreSQL, outbox + reconcile)';
const env = await setupDbTestEnvironment();

if (env.skip) {
  registerSkippedSuite(SUITE, env.skip);
} else {
  const { pool } = env;
  const {
    reserveSpend,
    commitSpend,
    processNextBudgetStop,
    releaseStaleReservations,
    BudgetExceededError,
  } = await import('../../lib/budget-service.js');

  const created = { organizationIds: [], userIds: [] };
  after(async () => {
    await cleanupFixtures(pool, created);
    await pool.end();
  });

  // A generous workspace limit and a tight per-member limit, so the member
  // scope is what exhausts — the scope whose stop-request path actually
  // works. (See the BUG note above for why workspace-scope is avoided here.)
  async function fixture({
    workspaceLimitCents = 100_000_000,
    memberLimitMicros = 1_000_000,
    transcriptionStatus = 'processing',
  } = {}) {
    const organizationId = await createTestOrganization(pool, { name: 'Lifecycle Test Org' });
    const userId = await createTestUser(pool);
    created.organizationIds.push(organizationId);
    created.userIds.push(userId);
    await addOrganizationMember(pool, organizationId, userId);
    await setWorkspaceLimit(pool, organizationId, workspaceLimitCents);
    await setMemberLimit(pool, organizationId, userId, memberLimitMicros);
    const transcriptionId = await createTestTranscription(pool, organizationId, userId, { status: transcriptionStatus });
    return { organizationId, userId, transcriptionId, memberLimitMicros };
  }

  /** Exhausts the member limit exactly, then triggers the member-scope stop request. */
  async function exhaustMemberBudgetAndRequestStop({ organizationId, userId, memberLimitMicros, tag }) {
    await reserveSpend({
      idempotencyKey: `${tag}:fill`,
      organizationId,
      userId,
      operation: 'translation',
      amountMicros: memberLimitMicros,
      expiresAt: futureIso(60),
    });
    await assert.rejects(
      reserveSpend({
        idempotencyKey: `${tag}:overflow`,
        organizationId,
        userId,
        operation: 'translation',
        amountMicros: 1,
        expiresAt: futureIso(60),
        stopOnDenied: true,
      }),
      (error) => error instanceof BudgetExceededError && error.scope === 'member' && error.availableMicros === 0,
    );
  }

  // ---- Threshold crossing -----------------------------------------------

  test('crossing the member budget threshold requests a stop and enqueues an outbox event', async () => {
    const { organizationId, userId, transcriptionId, memberLimitMicros } = await fixture();
    await exhaustMemberBudgetAndRequestStop({ organizationId, userId, memberLimitMicros, tag: `threshold:${organizationId}` });

    const outbox = await pool.query(
      `SELECT state, reason, payload FROM budget_stop_outbox WHERE organization_id = $1`,
      [organizationId],
    );
    assert.equal(outbox.rowCount, 1);
    assert.equal(outbox.rows[0].state, 'pending');
    assert.equal(outbox.rows[0].reason, 'hard_budget_member');
    assert.equal(outbox.rows[0].payload.scope, 'member');
    assert.equal(outbox.rows[0].payload.userId, userId);
    assert.deepEqual(outbox.rows[0].payload.transcriptionIds, [transcriptionId]);

    const transcription = await pool.query(
      `SELECT budget_stop_state, cancel_requested_at, cancel_reason FROM transcriptions WHERE id = $1`,
      [transcriptionId],
    );
    assert.equal(transcription.rows[0].budget_stop_state, 'requested');
    assert.ok(transcription.rows[0].cancel_requested_at);
    assert.equal(transcription.rows[0].cancel_reason, 'hard_budget_member');

    // A single member's exhaustion must not block the shared workspace
    // period for the rest of the org.
    const period = await pool.query(
      `SELECT state FROM organization_budget_periods WHERE organization_id = $1 AND period_start = $2::date`,
      [organizationId, currentPeriodStart()],
    );
    assert.equal(period.rows[0].state, 'open');
  });

  test('crossing the workspace budget threshold blocks the period and enqueues a stop', async () => {
    const organizationId = await createTestOrganization(pool, { name: 'Workspace Threshold Bug Org' });
    const userId = await createTestUser(pool);
    created.organizationIds.push(organizationId);
    created.userIds.push(userId);
    await addOrganizationMember(pool, organizationId, userId);
    await setWorkspaceLimit(pool, organizationId, 100); // 1,000,000 micros — this is the scope under test
    const transcriptionId = await createTestTranscription(pool, organizationId, userId);

    await reserveSpend({
      idempotencyKey: `workspace-threshold:${organizationId}:fill`,
      organizationId,
      userId,
      operation: 'translation',
      amountMicros: 1_000_000,
      expiresAt: futureIso(60),
    });

    // Expected behavior: BudgetExceededError(scope: 'workspace'), the period
    // flips to 'blocked', and a budget_stop_outbox row is created — exactly
    // like the member-scope test above. Today this instead throws
    // BudgetAccountingUnavailableError wrapping the Postgres 42P18 error.
    await assert.rejects(
      reserveSpend({
        idempotencyKey: `workspace-threshold:${organizationId}:overflow`,
        organizationId,
        userId,
        operation: 'translation',
        amountMicros: 1,
        expiresAt: futureIso(60),
        stopOnDenied: true,
      }),
      (error) => error instanceof BudgetExceededError && error.scope === 'workspace' && error.availableMicros === 0,
    );

    const period = await pool.query(
      `SELECT state FROM organization_budget_periods WHERE organization_id = $1 AND period_start = $2::date`,
      [organizationId, currentPeriodStart()],
    );
    assert.equal(period.rows[0].state, 'blocked');

    const outbox = await pool.query(
      `SELECT state, reason, payload FROM budget_stop_outbox WHERE organization_id = $1`,
      [organizationId],
    );
    assert.equal(outbox.rowCount, 1);
    assert.equal(outbox.rows[0].payload.scope, 'workspace');
    assert.deepEqual(outbox.rows[0].payload.transcriptionIds, [transcriptionId]);
  });

  // ---- Repeated / idempotent outbox delivery -----------------------------

  test('concurrent workers claim a pending stop event exactly once (FOR UPDATE SKIP LOCKED)', async () => {
    const { organizationId, userId, transcriptionId, memberLimitMicros } = await fixture();
    await exhaustMemberBudgetAndRequestStop({ organizationId, userId, memberLimitMicros, tag: `claim:${organizationId}` });
    await pool.query(
      `UPDATE budget_stop_outbox SET state = 'processed', processed_at = NOW()
        WHERE organization_id <> $1 AND state IN ('pending', 'processing')`,
      [organizationId],
    );

    let handledCount = 0;
    const handler = async (event) => {
      handledCount += 1;
      return event.payload.transcriptionIds;
    };

    // Two "workers" racing the same single pending event. Exactly one must
    // win the row; the other must come back empty-handed rather than
    // double-processing it.
    const [first, second] = await Promise.all([processNextBudgetStop(handler), processNextBudgetStop(handler)]);
    const claimed = [first, second].filter(Boolean);
    assert.equal(claimed.length, 1, 'exactly one concurrent worker should claim the single pending event');
    assert.equal(handledCount, 1);

    // Once processed, it must not be redelivered.
    const third = await processNextBudgetStop(handler);
    assert.equal(third, null);
    assert.equal(handledCount, 1);

    const transcription = await pool.query(
      `SELECT status, budget_stop_state FROM transcriptions WHERE id = $1`,
      [transcriptionId],
    );
    assert.equal(transcription.rows[0].status, 'cancelled');
    assert.equal(transcription.rows[0].budget_stop_state, 'stopped');
  });

  test('a failing delivery backs off and is genuinely retried later, not immediately or never', async () => {
    const { organizationId, userId, memberLimitMicros } = await fixture();
    await exhaustMemberBudgetAndRequestStop({ organizationId, userId, memberLimitMicros, tag: `retry:${organizationId}` });

    // First delivery fails (simulating e.g. a transient bridge/API error).
    await assert.rejects(processNextBudgetStop(async () => {
      throw new Error('simulated transient failure');
    }));

    const afterFailure = await pool.query(
      `SELECT id, state, attempts, available_at, last_error FROM budget_stop_outbox WHERE organization_id = $1`,
      [organizationId],
    );
    assert.equal(afterFailure.rows[0].state, 'pending');
    assert.equal(afterFailure.rows[0].attempts, 1);
    assert.match(afterFailure.rows[0].last_error, /simulated transient failure/);
    assert.ok(new Date(afterFailure.rows[0].available_at).getTime() > Date.now(), 'backoff must push available_at into the future');

    // Immediately retrying must NOT redeliver — the backoff window has not
    // elapsed, and a naive poll must not busy-loop on a failing event.
    let calledDuringBackoff = false;
    const duringBackoff = await processNextBudgetStop(async () => { calledDuringBackoff = true; return []; });
    assert.equal(duringBackoff, null);
    assert.equal(calledDuringBackoff, false);

    // Simulate the backoff window elapsing, then confirm the SAME event is
    // genuinely redelivered and this time succeeds.
    await pool.query(`UPDATE budget_stop_outbox SET available_at = NOW() WHERE organization_id = $1`, [organizationId]);
    let redeliveredId = null;
    const succeeded = await processNextBudgetStop(async (event) => {
      redeliveredId = event.id;
      return event.payload.transcriptionIds;
    });
    assert.ok(succeeded);
    assert.equal(redeliveredId, afterFailure.rows[0].id);
    assert.equal(succeeded.id, afterFailure.rows[0].id);

    const afterSuccess = await pool.query(
      `SELECT state, attempts FROM budget_stop_outbox WHERE organization_id = $1`,
      [organizationId],
    );
    assert.equal(afterSuccess.rows[0].state, 'processed');
    assert.equal(afterSuccess.rows[0].attempts, 2);
  });

  // ---- Concurrent streams -------------------------------------------------

  test('concurrent reserve/commit streams reconcile the period totals without lost updates', async () => {
    const organizationId = await createTestOrganization(pool, { name: 'Lifecycle Streams Org' });
    created.organizationIds.push(organizationId);
    // Generous limit — this test is about interleaving correctness, not
    // about denial.
    await setWorkspaceLimit(pool, organizationId, 100_000_000);
    const userA = await createTestUser(pool);
    const userB = await createTestUser(pool);
    created.userIds.push(userA, userB);
    await addOrganizationMember(pool, organizationId, userA);
    await addOrganizationMember(pool, organizationId, userB);

    const CYCLES = 5;
    const dynamicTestModel = `test/catalog-model-${organizationId}`;
    await pool.query(
      `INSERT INTO provider_price_versions
         (provider, model, operation, currency, input_unit, output_unit,
          input_price_per_million_micros, output_price_per_million_micros, effective_from)
       VALUES ('openrouter', $1, 'translation', 'USD', 'token', 'token', 1000, 2000, NOW())`,
      [dynamicTestModel],
    );
    async function stream(streamName, userId) {
      for (let i = 0; i < CYCLES; i += 1) {
        const reservation = await reserveSpend({
          idempotencyKey: `stream:${organizationId}:${streamName}:${i}`,
          organizationId,
          userId,
          operation: 'translation',
          amountMicros: 5_000_000,
          expiresAt: futureIso(60),
        });
        try {
          await commitSpend(reservation.id, {
            provider: 'openrouter',
            model: dynamicTestModel,
            usage: { input_tokens: 100 + i, output_tokens: 50 },
          });
        } catch (error) {
          throw error.cause || error;
        }
      }
    }

    // Two concurrent "meeting STT"-style streams hammering the same
    // organization-period row at once.
    await Promise.all([stream('A', userA), stream('B', userB)]);

    const period = await pool.query(
      `SELECT reserved_micros, committed_micros FROM organization_budget_periods
        WHERE organization_id = $1 AND period_start = $2::date`,
      [organizationId, currentPeriodStart()],
    );
    assert.equal(Number(period.rows[0].reserved_micros), 0, 'every reservation committed — nothing should remain reserved');

    const usage = await pool.query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(estimated_cost_micros), 0)::bigint AS total
         FROM usage_log WHERE organization_id = $1`,
      [organizationId],
    );
    assert.equal(usage.rows[0].n, CYCLES * 2);
    assert.equal(Number(period.rows[0].committed_micros), Number(usage.rows[0].total));

    const committedReservations = await pool.query(
      `SELECT COUNT(*)::int AS n FROM budget_reservations WHERE organization_id = $1 AND state = 'committed'`,
      [organizationId],
    );
    assert.equal(committedReservations.rows[0].n, CYCLES * 2);
  });

  // ---- Restart / reconcile: never revive a budget-stopped job -----------

  test('a worker restart reclaims a stuck processing event instead of losing it', async () => {
    const { organizationId, userId, transcriptionId, memberLimitMicros } = await fixture();
    await exhaustMemberBudgetAndRequestStop({ organizationId, userId, memberLimitMicros, tag: `restart:${organizationId}` });

    // Simulate a worker that claimed the event and then crashed before
    // finishing: state='processing' with a locked_at far enough in the past
    // to be past the 5-minute reclaim window in processNextBudgetStop's
    // SELECT.
    const claimed = await pool.query(
      `UPDATE budget_stop_outbox
          SET state = 'processing', attempts = attempts + 1, locked_at = NOW() - INTERVAL '10 minutes'
        WHERE organization_id = $1 RETURNING id`,
      [organizationId],
    );
    assert.equal(claimed.rowCount, 1);

    let handled = null;
    const event = await processNextBudgetStop(async (e) => {
      handled = e.id;
      return e.payload.transcriptionIds;
    });
    assert.ok(event, 'a restarted worker must reclaim the stale processing event');
    assert.equal(handled, claimed.rows[0].id);

    const transcription = await pool.query(
      `SELECT status, budget_stop_state FROM transcriptions WHERE id = $1`,
      [transcriptionId],
    );
    assert.equal(transcription.rows[0].status, 'cancelled');
    assert.equal(transcription.rows[0].budget_stop_state, 'stopped');
  });

  test('stale-reservation reconciliation releases holds behind a terminal job, and a stopped job is never revived', async () => {
    const { organizationId, userId, transcriptionId, memberLimitMicros } = await fixture({ memberLimitMicros: 50_000 });

    const reservation = await reserveSpend({
      idempotencyKey: `reconcile:${organizationId}:hold`,
      organizationId,
      userId,
      transcriptionId,
      operation: 'transcription',
      amountMicros: 10_000,
      expiresAt: futureIso(60),
    });

    // Fast-forward the hold past its expiry and mark the lifecycle as
    // tracked, exactly as the real worker path would before reconciliation
    // becomes eligible.
    await pool.query(
      `UPDATE budget_reservations
          SET expires_at = NOW() - INTERVAL '1 hour', lifecycle_tracked_at = NOW()
        WHERE id = $1`,
      [reservation.id],
    );
    // The job reached a terminal, budget-stopped state (as if the stop
    // worker had already processed it).
    await pool.query(
      `UPDATE transcriptions SET status = 'cancelled', budget_stop_state = 'stopped' WHERE id = $1`,
      [transcriptionId],
    );

    const isTerminal = async (candidate) => {
      const result = await pool.query(
        `SELECT status, budget_stop_state FROM transcriptions WHERE id = $1`,
        [candidate.transcription_id],
      );
      const row = result.rows[0];
      return Boolean(row) && (
        ['completed', 'transcribed', 'error', 'cancelled'].includes(row.status)
        || row.budget_stop_state === 'stopped'
      );
    };
    const releasedCount = await releaseStaleReservations({ isTerminal });
    assert.ok(releasedCount >= 1);

    const releasedReservation = await pool.query(`SELECT state FROM budget_reservations WHERE id = $1`, [reservation.id]);
    assert.equal(releasedReservation.rows[0].state, 'expired');

    // Now prove the "never revive" half: exhaust this same user's member
    // budget again (the earlier hold was just released, so the limit is
    // free again) and let requestBudgetStop's stop-request UPDATE run
    // across the org. Our transcription is already 'cancelled', which is
    // outside the eligible status list ('pending','queued','processing',
    // 'analyzing','transcribed') — it must come back completely untouched,
    // i.e. a worker/reconcile pass must never re-open a stopped job.
    await reserveSpend({
      idempotencyKey: `reconcile:${organizationId}:refill`,
      organizationId,
      userId,
      operation: 'translation',
      amountMicros: memberLimitMicros,
      expiresAt: futureIso(60),
    });
    await assert.rejects(reserveSpend({
      idempotencyKey: `reconcile:${organizationId}:revive-attempt`,
      organizationId,
      userId,
      operation: 'translation',
      amountMicros: 1,
      expiresAt: futureIso(60),
      stopOnDenied: true,
    }), (error) => error instanceof BudgetExceededError && error.scope === 'member');

    const untouched = await pool.query(
      `SELECT status, budget_stop_state, cancel_requested_at FROM transcriptions WHERE id = $1`,
      [transcriptionId],
    );
    assert.equal(untouched.rows[0].status, 'cancelled');
    assert.equal(untouched.rows[0].budget_stop_state, 'stopped');
  });
}
