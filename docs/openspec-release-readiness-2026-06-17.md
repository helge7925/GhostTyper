# OpenSpec: Release Readiness Cleanup

Date: 2026-06-17
Status: completed

## Goal

Bring GhostTyper's current repository state to a release-ready baseline by
closing known dependency/security gaps, stabilising local tests, and aligning
documentation with the implemented product surface.

## Scope

- Patch production dependency vulnerabilities where compatible with the current
  Next.js Pages Router stack.
- Stabilise DNS-dependent unit tests so the suite runs without external network
  access.
- Align versions, test counts, framework references, screenshots, and feature
  claims across README, changelog, memory, and docs.
- Tighten CI security gates so high-severity production advisories are visible.
- Update Vexa documentation after the `fireworks-bridge` to `voxtral-bridge`
  rename.

## Out of Scope

- Implementing removed or roadmap-only features such as realtime sessions,
  workflows, sketch generation, or photo-to-table-template generation.
- Large auth or Vexa architecture rewrites beyond documentation and dependency
  remediation.
- Generating authenticated UI screenshots if a runnable seeded environment is
  not already available.

## Acceptance Criteria

- `npm test` passes in the restricted local environment.
- `npm run lint` passes.
- `npm run build` passes.
- `npm audit --omit=dev` has no unaddressed high/critical production findings,
  or every remaining finding is explicitly documented with a concrete blocker
  and mitigation.
- README and docs do not reference missing screenshots as primary images.
- README/docs/changelog agree on current package version, framework version,
  and implemented feature surface.

## Dependency Security Status

- Resolved compatible production advisories with `npm audit fix --omit=dev`:
  `axios`, `dompurify`, transitive `form-data`, `protobufjs`, and transitive
  `tmp`.
- Remaining `npm audit --omit=dev` findings are moderate and only expose
  breaking/force fixes: `nodemailer` via `next-auth`, bundled `postcss` via
  `next`, and `uuid` via `exceljs`/`next-auth`.
- Mitigation until upstream-compatible fixes are available: do not run
  `npm audit fix --force`; keep framework/auth migrations tracked separately,
  and avoid exposing user-controlled SMTP transport names, message headers, CSS
  stringification input, or direct `uuid` v3/v5/v6 buffer calls.

## Tasks

1. Dependency security update.
2. DNS-independent network-guard tests.
3. README, Memory, and testing documentation alignment.
4. Changelog/API-documentation cleanup for removed feature claims.
5. CI security gate update.
6. Vexa documentation cleanup.

## Verification

- `npm test` passes: 139/139 tests.
- `npm run lint` passes. Note: `next lint` is deprecated and should be
  migrated before Next.js 16.
- `npm run build` passes on Next.js 15.5.19. Remaining warnings are existing
  operational warnings: `_app.getInitialProps` disables automatic static
  optimisation and Chromium logs `--localstorage-file` without a valid path.
- `npm audit --audit-level=high --omit=dev` passes. Full
  `npm audit --omit=dev` still reports moderate force-only findings listed
  above.
