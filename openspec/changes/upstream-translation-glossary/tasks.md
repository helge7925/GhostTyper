# Tasks: Upstream Translation Glossary + TM

Source of truth: romaco-scriptor, branch `feat/translation-excellence`
(HEAD 955e95d — the finished two-tier system). Copy → adapt imports
(GhostTyper uses extension-less relative imports).

> **Sequencing note (2026-07-16):** port AFTER romaco-scriptor's
> `personal-workspace-glossary` lands, so the two-tier system
> (personal + workspace, `user_id` column, scoped API, TM leak guard)
> is ported in one pass instead of retrofitted.

## 1. Port files (verified inventory, 2026-07-16)

- [x] `lib/translation-glossary.js` (includes `lookupTMBatch`,
      `protectDoNotTranslate`, `selectRelevantEntries`,
      `buildGlossaryPromptBlock`, `lookupTM`, `storeTM`,
      `getGlossaryForPair`, plus the two-tier merge, quality guards,
      applied-terms metadata and `upsertVerifiedTM`)
- [x] `lib/translation-glossary-validation.js`
- [x] `lib/glossary-interop.js` (CSV/TBX round-trip)
- [x] `pages/api/glossary/index.js`, `pages/api/glossary/[id].js`,
      `pages/api/glossary/suggestions.js`, `pages/api/glossary/tm.js`,
      `pages/api/glossary/export.js`, `pages/api/glossary/import.js`
- [x] `tests/translation-glossary.test.mjs`, `tests/glossary-interop.test.mjs`
- [x] `scripts/seed-translation-glossary.mjs` — replaced the Romaco
      pharma seed (`lib/romaco-glossary.js`, stays fork-only) with a
      small generic example seed.
- [x] db-init blocks: `translation_glossary`, `translation_memory`
      tables + indexes (incl. `user_id`, `COALESCE(user_id,0)` unique
      indexes, `verified`/`last_used_at`; migration lines kept
      idempotent).

## 2. Wire into translation paths (mirror Romaco call sites)

- [x] `pages/api/translate.js`: TM lookup → glossary block → mask →
      translate → restore → storeTM, additive `glossary` metadata in
      the response.
- [x] `pages/api/translate/file.js`: office path via the
      `translateSegmentsWithGlossary` wrapper; PDF path per-chunk
      TM + glossary; `X-GhostTyper-Glossary` response header.
- [x] `lib/vexa-bridge.js`: delta translation with glossary prompt
      block, 60s glossary cache TTL, batched TM lookup, storeTM
      (Romaco's `runTranslationDelta` is the reference implementation).
- [x] `lib/ai-service.js`: `strictPlaceholders` option in
      `translateText`/`translateTextSegments`.

## 3. UI

- [x] Settings glossary tab (two-tier CRUD, do-not-translate flag,
      CSV/TBX import/export, TM browser) — extracted to
      `components/settings/GlossaryPanel.js` (matches GhostTyper's
      `components/settings/*Panel.js` convention). Permissions gate on
      the existing `org.settings` / `org.read` (no `glossary.manage`
      mapping needed — see status.md).
- [x] `components/TranslationTermPanel.js` rendered on `pages/translate.js`
      for the text + file flows.
- [x] i18n keys de/en (`settings.glossary.*`, `settings.tabs.glossary`,
      `translatePage.terms.*`).

## 4. Definition of Done

- [x] `npm test` + lint green (216 tests, 206 pass / 10 skipped / 0 fail;
      +47 ported glossary/interop tests). `npm run build` compiles.
- [ ] Manual: create glossary entry (target term + one do-not-translate
      product name) → inline translate + office file translate both
      honour it; second identical translation hits TM (usage_log shows
      no provider call for the cached segment). **Needs a live env**
      (DB + Cortecs key) — not runnable in this porting pass.
- [x] Orgs without glossary entries: behavior unchanged (all glossary
      response fields are additive; empty-glossary path exercised by the
      ported unit tests).
