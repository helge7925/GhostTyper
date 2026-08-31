# Design: Add OpenRouter Admin Console UI Tests

## Tooling Choice

The project runs all tests through Node's built-in `node --test`
(`package.json` `test`/`test:db` scripts) and deliberately has no Jest or
other heavy test framework. Rather than introduce one just for a handful of
component tests, register a DOM environment (`jsdom`, already a transitive
dependency of the Next.js toolchain — confirm and pin explicitly if not)
directly inside a `tests/ui/helpers.mjs` bootstrap that individual
`node --test` files `import` before rendering, and drive interactions with
`@testing-library/react` + `@testing-library/user-event`. This keeps the
single `test` script and CI step; no parallel test runner to maintain.

If `node --test` proves awkward for JSX transform (Next.js normally relies
on its own build pipeline, not a standalone Babel/SWC step for tests), the
fallback is `@swc/register`-style on-the-fly transform in
`tests/ui/helpers.mjs`, scoped only to files under `tests/ui/`. Either way,
production code and its build pipeline are untouched.

## What Gets Tested

`components/settings/OpenRouterIntegrationPanel.js` (rendered with mocked
`fetch` responses for `GET /api/organizations/integrations/openrouter` and
`GET /api/models`):

- **Capability tabs**: switching between chat/ocr/transcription/
  liveTranscription/tts shows that capability's allowed models and default,
  not another capability's.
- **Search/filter**: typing in the model search narrows the visible catalog
  list by id/name substring.
- **Allowlist add/remove**: toggling a model updates the pending
  `allowedModels[capability]` state; removing the current default from the
  allowlist is reflected before save.
- **Default-model enforcement**: the default-model selector only offers
  models already in that capability's allowlist (mirrors the server-side
  `validateGovernanceConfig` invariant — this test catches drift between
  client and server enforcement).
- **Unavailable model**: a model present in `defaultModels`/`allowedModels`
  but absent from the current `GET /api/models` catalog response renders
  with a visible "not available" indicator rather than silently
  disappearing or crashing the panel.
- **Activation gating**: the activate control is disabled until all five
  capability defaults are set (and shows why), matching the server-side
  `activate` endpoint's precondition.

Tests assert on rendered DOM state and `fetch` call bodies (e.g. the `PUT`
payload after an allowlist edit), not on internal component state, so they
stay resilient to refactors.
