# Change: Port Budget Runtime And Pricing Engine From Downstream

## Why

GhostTyper tracks cost after the fact (`lib/usage.js`) and has a
pre-flight check (`lib/budget-guardrails.js`), but it cannot actually stop
spending. For a self-hosted product whose README advertises cost tracking,
the missing half is the enforcement: reservations before a run, hard
limits per workspace and per member, versioned provider prices, and a
worker that stops runaway jobs.

Downstream `romaco-scriptor` built that runtime on top of the same two
modules GhostTyper already has, with no customer-specific coupling in the
core (`lib/budget-core.js` has zero Romaco references) and seven test
files covering it.

## Decisions Captured

- GhostTyper SHALL enforce budgets, not only report usage.
- Budgets SHALL exist per organization period and per member.
- Cost SHALL be reserved before a run and reconciled after it, so
  concurrent runs cannot jointly overshoot a limit.
- Provider prices SHALL be versioned, with per-organization overrides.
- Exceeding a hard limit SHALL stop the run via a durable outbox worker
  with backoff, rather than a best-effort in-process abort.
- Live cost and job progress SHALL be visible while a run is in flight.

## What Changes

- Port `lib/budget-core.js`, `budget-runtime-core.js`, `budget-runtime.js`,
  `budget-service.js`, `budget-cancellation.js`, `budget-stop-worker.js`.
- Port `lib/pricing-core.js`, `pricing-seed.js`, `pricing-service.js`.
- Port `lib/live-usage.js`, `lib/job-progress.js`, `lib/use-job-progress.js`.
- Port `lib/billing-ui.js`, `components/PersonalBudgetCard.js`,
  `components/PricingRateFields.js`.
- Add six additive tables: `budget_reservations`, `budget_stop_outbox`,
  `organization_budget_periods`, `organization_member_budgets`,
  `organization_price_overrides`, `provider_price_versions`.
- Port the API surface: `pages/api/usage/live.js`, `pages/api/usage/me.js`,
  `pages/api/organizations/budgets.js`, `pages/api/organizations/pricing.js`.
- Extend the existing `lib/budget-guardrails.js` rather than replacing it.

## Out Of Scope

- Billing/invoicing or payment integration.
- Changing existing usage-log semantics or historical data.
- Per-feature (as opposed to per-run) cost attribution beyond what the
  downstream implementation already does.

## Success Criteria

- A workspace that reaches its hard limit cannot start further paid runs.
- A run that exceeds its limit mid-flight is stopped by the worker.
- Concurrent runs cannot jointly exceed a limit (reservations hold).
- Admins can set organization and per-member budgets and price overrides.
- Users see live cost and progress during a run.
- All ported budget/pricing tests pass upstream.
