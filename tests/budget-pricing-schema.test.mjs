import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schema = readFileSync(new URL('../lib/db-init.js', import.meta.url), 'utf8');

test('db-init additively defines budget, pricing, reservation, and stop durability tables', () => {
  for (const table of [
    'organization_member_budgets',
    'provider_price_versions',
    'organization_price_overrides',
    'organization_budget_periods',
    'budget_reservations',
    'budget_stop_outbox',
  ]) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  for (const column of [
    'price_version_id', 'cached_input_quantity', 'cache_write_quantity',
    'estimated_cost_micros', 'provider_request_id', 'idempotency_key',
  ]) {
    assert.match(schema, new RegExp(`usage_log ADD COLUMN IF NOT EXISTS ${column}`));
  }
  assert.match(schema, /cancel_requested_at/);
  assert.match(schema, /budget_stop_state/);
  assert.match(schema, /budget_stop_outbox ADD COLUMN IF NOT EXISTS revision/);
  for (const column of [
    'lifecycle_tracked_at', 'provider_started_at', 'accounting_pending_at', 'speculative',
  ]) {
    assert.match(schema, new RegExp(`budget_reservations ADD COLUMN IF NOT EXISTS ${column}`));
  }
});

test('legacy member limits are copied once to every existing membership using the smallest positive value', () => {
  assert.match(schema, /migration\.organization_member_budgets_v1/);
  assert.match(schema, /LEAST\(s\.cost_limit, s\.member_monthly_budget_limit\)/);
  assert.match(schema, /migrated_from_legacy/);
});
