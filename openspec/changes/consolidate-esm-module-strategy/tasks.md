# Tasks: Consolidate ESM Module Strategy

- [x] Add `"type": "module"` to `package.json`.
- [x] Convert `next.config.js` to `export default`.
- [x] Convert `postcss.config.js` to `export default`.
- [x] Convert `tailwind.config.js` to `export default` and replace the
      inline `require('tailwindcss-animate')`.
- [x] Make `public/sw-policy.js` loadable under ESM-default resolution
      without breaking classic-script service-worker usage; unskip/fix the
      two `tests/offline-queue.test.mjs` tests.
- [x] Remove `--no-warnings` from `test` and `test:db` scripts.
- [x] Verify: `npm run lint`, `npm test`, `npm run build`, and
      `npm run test:db` against a throwaway PostgreSQL 16 all pass
      warning-free.
- [x] Update `docs/openspec-release-readiness-2026-06-17.md` M-04 entry.
