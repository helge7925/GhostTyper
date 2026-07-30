# Tasks: Port Empty States, Onboarding And Error Pages

## 1. Error Pages

- [ ] Port `pages/404.js` using current tokens/primitives.
- [ ] Port `pages/500.js` using current tokens/primitives.
- [ ] Provide a way back into the app from both.

## 2. Empty State

- [ ] Port `components/EmptyState.js`.
- [ ] Adopt it in transcriptions, documents, audit and settings sub-lists.
- [ ] Keep the component presentational; copy comes from call sites.

## 3. Onboarding

- [ ] Port `components/OnboardingIntro.js`.
- [ ] Persist the seen flag via existing per-user preference storage.
- [ ] Confirm it does not reappear for returning users.

## 4. i18n

- [ ] Add all new strings to `messages/de.json`.
- [ ] Add the same keys to `messages/en.json`.

## 5. Verification

- [ ] Confirm `tests/ui-accessibility.test.mjs` still passes.
- [ ] Check AA contrast in light and dark for all new surfaces.
- [ ] `npm run lint`.
- [ ] `npm test`.
- [ ] `npm run build`.

## Explicitly Not In Scope

- [ ] `components/MatrixRain.js` is deliberately **not** ported.
