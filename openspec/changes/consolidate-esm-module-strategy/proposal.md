# Change: Consolidate ESM Module Strategy

## Why

Audit 2026-02-21 (M-04, `docs/cybersecurity-audit-2026-02-21.md`) flags the
mixed ESM/CJS module strategy as a maintenance and tooling risk: `package.json`
has no `"type"` field, config files use `module.exports`, and the test
scripts carry a `--no-warnings` workaround that suppresses Node's
`MODULE_TYPELESS_PACKAGE_JSON` warnings instead of eliminating their cause.
The warnings reappear in every direct `node` invocation (e.g. ad-hoc DB
seeding) and the mixed strategy will break silently as dependencies drop
CJS support.

## What Changes

- Add `"type": "module"` to `package.json`.
- Convert `next.config.js`, `postcss.config.js`, and `tailwind.config.js`
  from `module.exports` to `export default` (and the inline
  `require('tailwindcss-animate')` to an ESM import or string plugin entry).
- Rework `public/sw-policy.js`'s CommonJS export so the policy stays loadable
  both as a service-worker classic script and from
  `tests/offline-queue.test.mjs`'s `createRequire` — the naive `"type":
  "module"` flip breaks exactly these two tests today because
  `module.exports` no longer attaches. Candidate: dual-register via
  `globalThis` plus a detected-CJS guard, or switch the test to evaluate the
  script text the same way the service worker does.
- Remove `--no-warnings` from the `test` and `test:db` scripts once the
  suite runs warning-free.
- Update `docs/openspec-release-readiness-2026-06-17.md` M-04 entry to
  "Fixed".

## Impact

Verified experimentally 2026-09-30 on a scratch checkout: the flip is small
(4 config/package files) but the two `tests/offline-queue.test.mjs` failures
must be solved first; lint warnings (2) and the full 480-test suite plus
`npm run build` must be re-verified after conversion.
