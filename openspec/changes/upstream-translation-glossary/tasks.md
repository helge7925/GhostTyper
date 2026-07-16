# Tasks: Upstream Translation Glossary + TM

Source of truth: romaco-scriptor, branch `codex/cortecs-provider-parity`.
Copy → adapt imports (GhostTyper uses extension-less relative imports).

> **Sequencing note (2026-07-16):** port AFTER romaco-scriptor's
> `personal-workspace-glossary` lands, so the two-tier system
> (personal + workspace, `user_id` column, scoped API, TM leak guard)
> is ported in one pass instead of retrofitted.

## 1. Port files (verified inventory, 2026-07-16)

- [ ] `lib/translation-glossary.js` (includes `lookupTMBatch`,
      `protectDoNotTranslate`, `selectRelevantEntries`,
      `buildGlossaryPromptBlock`, `lookupTM`, `storeTM`,
      `getGlossaryForPair`)
- [ ] `lib/translation-glossary-validation.js`
- [ ] `pages/api/glossary/index.js`, `pages/api/glossary/[id].js`,
      `pages/api/glossary/suggestions.js`
- [ ] `tests/translation-glossary.test.mjs`
- [ ] `scripts/seed-translation-glossary.mjs` — replace the Romaco
      pharma seed (`lib/romaco-glossary.js`, stays fork-only) with a
      small generic example seed.
- [ ] db-init blocks: `translation_glossary`, `translation_memory`
      tables + their four indexes (copy verbatim from Romaco db-init).

## 2. Wire into translation paths (mirror Romaco call sites)

- [ ] `pages/api/translate.js`: TM lookup → glossary block → mask →
      translate → restore → storeTM (compare Romaco file directly).
- [ ] `pages/api/translate/file.js`: office path via a
      `translateSegmentsWithGlossary`-style wrapper; PDF path per-chunk
      TM + glossary (again: Romaco file is the reference).
- [ ] `lib/vexa-bridge.js`: delta translation with glossary prompt
      block, 60s glossary cache TTL, batched TM lookup, storeTM
      (Romaco's `runTranslationDelta` is the reference implementation).

## 3. UI

- [ ] Settings glossary tab (CRUD, do-not-translate flag, CSV import) —
      port the glossary section from Romaco `pages/settings.js` +
      permissions (`glossary.manage` mapping in `lib/permissions.js`).
- [ ] i18n keys de/en.

## 4. Definition of Done

- [ ] `npm test` + lint green (ported test file passes).
- [ ] Manual: create glossary entry (target term + one do-not-translate
      product name) → inline translate + office file translate both
      honour it; second identical translation hits TM (usage_log shows
      no provider call for the cached segment).
- [ ] Orgs without glossary entries: behavior unchanged.
