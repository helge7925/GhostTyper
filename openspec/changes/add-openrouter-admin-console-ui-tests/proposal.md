# Change: Add OpenRouter Admin Console UI Tests

## Why

`components/settings/OpenRouterIntegrationPanel.js` is the only place a
workspace admin manages the OpenRouter allowlist, per-capability defaults,
TTS voices and activation — get it wrong and the org either can't activate
OpenRouter at all or silently exposes a model that isn't actually approved.
A post-launch audit of `consolidate-ai-providers-openrouter` (2026-08-23)
found this panel has zero automated test coverage, and the repository has
no component-testing framework configured at all (no `@testing-library`,
no `jsdom`), so a regression here currently surfaces only when an admin
hits friction in production — backend validation is the only remaining
safety net.

## What Changes

- Introduce a lightweight component-testing setup for React admin UI,
  consistent with the project's existing preference for Node's built-in
  test runner over a heavier framework.
- Add tests for the OpenRouter admin panel: capability-tab switching,
  model search/filter, allowlist add/remove, default-model selection
  constrained to its capability's allowlist, display of a previously
  allowed model that has disappeared from the live catalogue, and the
  activation control's disabled/enabled state.

No production behavior changes.

## Capabilities

### New Capabilities

- `openrouter-admin-console`: automated UI coverage for the OpenRouter
  workspace-admin settings panel and the component-testing tooling it runs
  on.

### Modified Capabilities

(none)

## Impact

- `package.json` (new dev dependencies: `@testing-library/react`,
  `@testing-library/user-event`, a DOM environment such as `jsdom`)
- `tests/ui/helpers.mjs` (new: registers a DOM environment for `node --test`)
- `tests/ui/openrouter-admin-console.test.mjs` (new)
- `components/settings/OpenRouterIntegrationPanel.js` (test-id attributes
  only, if needed for stable selectors — no behavior change)
