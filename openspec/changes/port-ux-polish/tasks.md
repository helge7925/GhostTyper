# Tasks: Port Empty States, Onboarding And Error Pages

## 1. Error Pages

- [x] Port `pages/404.js` using current tokens/primitives.
- [x] Port `pages/500.js` using current tokens/primitives.
- [x] Provide a way back into the app from both.

## 2. Empty State

- [x] Port `components/EmptyState.js`.
- [x] Adopt it in transcriptions, documents, audit and settings sub-lists.
- [x] Keep the component presentational; copy comes from call sites.

## 3. Onboarding

- [x] Port `components/OnboardingIntro.js`.
- [x] Persist the seen flag via existing per-user preference storage.
- [x] Confirm it does not reappear for returning users.

## 4. i18n

- [x] Add all new strings to `messages/de.json`.
- [x] Add the same keys to `messages/en.json`.

## 5. Verification

- [x] Confirm `tests/ui-accessibility.test.mjs` still passes.
- [x] Check AA contrast in light and dark for all new surfaces.
- [x] `npm run lint`.
- [x] `npm test`.
- [x] `npm run build`.

## Explicitly Not In Scope

- [x] `components/MatrixRain.js` is deliberately **not** ported.
