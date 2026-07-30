# Tasks: Port Budget Runtime And Pricing Engine

## 1. Schema

- [ ] Add `provider_price_versions` (additive) in `lib/db-init.js`.
- [ ] Add `organization_price_overrides`.
- [ ] Add `organization_budget_periods`.
- [ ] Add `organization_member_budgets`.
- [ ] Add `budget_reservations`.
- [ ] Add `budget_stop_outbox`.
- [ ] Verify `initDatabase()` stays idempotent.

## 2. Pricing Core

- [ ] Port `lib/pricing-core.js`, `pricing-seed.js`, `pricing-service.js`.
- [ ] Seed default provider prices idempotently.
- [ ] Support per-organization price overrides.

## 3. Budget Core And Runtime

- [ ] Port `lib/budget-core.js`, `budget-runtime-core.js`, `budget-runtime.js`.
- [ ] Port `lib/budget-service.js` and `budget-cancellation.js`.
- [ ] Implement reservation insert / reconcile / expiry.
- [ ] Extend existing `lib/budget-guardrails.js` to consult reservations
      (do not replace it).
- [ ] Hook reconciliation into existing `lib/usage.js` recording.

## 4. Stop Worker

- [ ] Port `lib/budget-stop-worker.js` including backoff + escalation.
- [ ] Ensure failing stop events never loop indefinitely.

## 5. Live Cost And Progress

- [ ] Port `lib/live-usage.js`, `lib/job-progress.js`, `lib/use-job-progress.js`.
- [ ] Port `lib/billing-ui.js`.

## 6. API

- [ ] Port `pages/api/usage/live.js` and `pages/api/usage/me.js`.
- [ ] Port `pages/api/organizations/budgets.js` (admin-only).
- [ ] Port `pages/api/organizations/pricing.js` (admin-only).

## 7. UI

- [ ] Port `components/PersonalBudgetCard.js`.
- [ ] Port `components/PricingRateFields.js`.
- [ ] Add budget/pricing admin surface to `pages/settings.js`.
- [ ] Use current UI primitives (post-sprezzatura tokens/components).

## 8. i18n

- [ ] Add budget/pricing strings to `messages/de.json`.
- [ ] Add the same keys to `messages/en.json`.

## 9. Verification

- [ ] Port the nine budget/pricing test files.
- [ ] `npm run lint`.
- [ ] `npm test`.
- [ ] `npm run build`.
- [ ] PostgreSQL smoke: `initDatabase()` idempotent, reservations expire,
      concurrent runs cannot jointly exceed a limit.
