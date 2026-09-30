# Tasks: Consolidate ESM Module Strategy

- [ ] Add `"type": "module"` to `package.json`.
- [ ] Convert `next.config.js` to `export default`.
- [ ] Convert `postcss.config.js` to `export default`.
- [ ] Convert `tailwind.config.js` to `export default` and replace the
      inline `require('tailwindcss-animate')`.
- [ ] Make `public/sw-policy.js` loadable under ESM-default resolution
      without breaking classic-script service-worker usage; unskip/fix the
      two `tests/offline-queue.test.mjs` tests.
- [ ] Remove `--no-warnings` from `test` and `test:db` scripts.
- [ ] Verify: `npm run lint`, `npm test`, `npm run build`, and
      `npm run test:db` against a throwaway PostgreSQL 16 all pass
      warning-free.
- [ ] Update `docs/openspec-release-readiness-2026-06-17.md` M-04 entry.
