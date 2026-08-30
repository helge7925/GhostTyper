# Tasks: Add OpenRouter Admin Console UI Tests

## 1. Test Tooling

- [ ] 1.1 Add `@testing-library/react`, `@testing-library/user-event` and a
  DOM environment (`jsdom` or equivalent) as dev dependencies.
- [ ] 1.2 Add `tests/ui/helpers.mjs` bootstrapping the DOM environment (and
  a JSX transform if `node --test` needs one) for `node --test` files under
  `tests/ui/`.
- [ ] 1.3 Confirm the existing `npm test` script picks up `tests/ui/*.test.mjs`
  (extend the glob if needed) so no separate CI step is required.

## 2. Admin Console Tests

- [ ] 2.1 Capability tabs render and switch allowed/catalog model lists per
  capability.
- [ ] 2.2 Model search/filter narrows the visible list.
- [ ] 2.3 Allowlist add/remove updates pending config and the `PUT` payload.
- [ ] 2.4 Default-model selector only offers allowlisted models for the
  active capability.
- [ ] 2.5 A configured model absent from the live catalogue renders an
  "unavailable" indicator instead of disappearing silently.
- [ ] 2.6 Activation control stays disabled until all five capability
  defaults are set, and reflects why.

## 3. Verification

- [ ] 3.1 `npm run lint` and the full test suite (including the new UI
  tests) pass.
- [ ] 3.2 `openspec validate add-openrouter-admin-console-ui-tests --strict`
  passes.
