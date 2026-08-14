# Tasks: Port Budget Runtime And Pricing Engine

## 1. Schema

- [x] Add `provider_price_versions` (additive) in `lib/db-init.js`.
- [x] Add `organization_price_overrides`.
- [x] Add `organization_budget_periods`.
- [x] Add `organization_member_budgets`.
- [x] Add `budget_reservations`.
- [x] Add `budget_stop_outbox`.
- [ ] Verify `initDatabase()` stays idempotent against disposable PostgreSQL.

## 2. Pricing Core

- [x] Port `lib/pricing-core.js`, `pricing-seed.js`, `pricing-service.js`.
- [x] Seed default provider prices idempotently.
- [x] Support per-organization price overrides.

## 3. Budget Core And Runtime

- [x] Port `lib/budget-core.js`, `budget-runtime-core.js`, `budget-runtime.js`.
- [x] Port `lib/budget-service.js` and `budget-cancellation.js`.
- [x] Implement reservation insert / reconcile / expiry.
- [x] Extend existing `lib/budget-guardrails.js` to consult reservations
      (do not replace it).
- [x] Hook reconciliation into existing `lib/usage.js` recording.

## 4. Stop Worker

- [x] Port `lib/budget-stop-worker.js` including backoff + escalation.
- [x] Ensure failing stop events never loop indefinitely.

## 5. Live Cost And Progress

- [x] Port `lib/live-usage.js`, `lib/job-progress.js`, `lib/use-job-progress.js`.
- [x] Port `lib/billing-ui.js`.

## 6. API

- [x] Port `pages/api/usage/live.js` and `pages/api/usage/me.js`.
- [x] Port `pages/api/organizations/budgets.js` (admin-only).
- [x] Port `pages/api/organizations/pricing.js` (admin-only).

## 7. UI

- [x] Port `components/PersonalBudgetCard.js`.
- [x] Port `components/PricingRateFields.js`.
- [x] Add budget/pricing admin surface to `pages/settings.js`.
- [x] Use current UI primitives (post-sprezzatura tokens/components).

## 8. i18n

- [x] Add budget/pricing strings to `messages/de.json`.
- [x] Add the same keys to `messages/en.json`.

## 9. Verification

- [x] Port the nine budget/pricing test files.
- [x] `npm run lint`.
- [x] `npm test`.
- [x] `npm run build`.
- [ ] PostgreSQL smoke: `initDatabase()` idempotent, reservations expire,
      concurrent runs cannot jointly exceed a limit.
