# Tasks: Two-Tier Glossary (Upstream)

- [x] Wait for romaco-scriptor `personal-workspace-glossary` to land
      (done downstream on `feat/translation-excellence`, HEAD 955e95d).
- [x] Execute `upstream-translation-glossary` against the two-tier
      state — its file inventory already contains `user_id`, scope-aware
      API routes and the split (personal / workspace) settings UI.
- [x] Port the two-tier tests (merge precedence, personal isolation,
      TM-skip leak guard, permission enforcement) — all present in
      `tests/translation-glossary.test.mjs`.
- [x] Definition of Done mirrors the Romaco spec's DoD (see
      `upstream-translation-glossary/tasks.md` §4; the manual live-env
      check remains open).
