# Design: Port Budget Runtime And Pricing Engine

## Source

Downstream `romaco-scriptor`, ~2,500 LOC across:

- Budget: `budget-core.js`, `budget-runtime-core.js`, `budget-runtime.js`,
  `budget-service.js`, `budget-cancellation.js`, `budget-stop-worker.js`
- Pricing: `pricing-core.js`, `pricing-seed.js`, `pricing-service.js`
- Live view: `live-usage.js`, `job-progress.js`, `use-job-progress.js`,
  `billing-ui.js`
- UI: `components/PersonalBudgetCard.js`, `components/PricingRateFields.js`
- API: `pages/api/usage/live.js`, `pages/api/usage/me.js`,
  `pages/api/organizations/budgets.js`, `pages/api/organizations/pricing.js`
- Tests: `budget-core`, `budget-runtime`, `budget-guardrails`,
  `budget-api-contract`, `budget-ui-contract`, `budget-pricing-schema`,
  `pricing-core`, `vexa-budget-safety`, `live-cost-progress`

## Relationship To Existing Upstream Code

GhostTyper already has `lib/budget-guardrails.js` and `lib/usage.js`. The
port **extends** these rather than replacing them: guardrails become the
pre-flight gate that consults the new reservation/limit state, and
`usage.js` remains the record of actual spend that reservations reconcile
against. Do not fork or duplicate usage recording.

## Schema (additive only)

Six new tables:

- `provider_price_versions` — price per provider/model/operation with an
  effective range, so historical runs cost correctly.
- `organization_price_overrides` — per-org override of a price version.
- `organization_budget_periods` — the period and its hard/soft limits.
- `organization_member_budgets` — per-member limit within an org.
- `budget_reservations` — estimated cost held for an in-flight run.
- `budget_stop_outbox` — durable stop events with attempt/backoff state.

All additive `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE … ADD COLUMN IF
NOT EXISTS` in `lib/db-init.js`; `initDatabase()` must stay idempotent.

## Reservation Lifecycle

1. Pre-flight: estimate cost, check org + member limits including
   outstanding reservations, then insert a reservation.
2. In-flight: `live-usage` accumulates actual cost; if it crosses the
   limit, enqueue a stop event in `budget_stop_outbox`.
3. Completion: delete the reservation and record actual usage via
   `usage.js`.
4. Crash safety: stale reservations must expire so a crashed run does not
   permanently consume budget.

## Stop Worker

`budget-stop-worker.js` drains `budget_stop_outbox` with exponential
backoff and escalation. Upstream already fixed the analogous downstream
bug (`501410c fix(budget): back off and escalate failing stop events
instead of looping`) — port the fixed behaviour, not the original loop.

## Files Changed

New: the twelve `lib/` modules above, two components, four API routes,
nine test files.
Modified: `lib/db-init.js`, `lib/budget-guardrails.js`, `lib/usage.js`
(reconciliation hook), `pages/settings.js` (budget/pricing admin surface),
`pages/api/usage.js`, `messages/de.json`, `messages/en.json`.

## Risks

- Largest change of the port set; land it as its own PR.
- Touches `lib/db-init.js`, which the audit-chain and mobile-field-mode
  ports also touch — sequence or merge those migration blocks carefully.
- Reservation accounting is the correctness-critical part; the ported
  tests must pass before wiring the UI.
