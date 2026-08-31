# Change: Upstream the Translation Glossary + Translation Memory

## Why

Context-sensitive translation with a customer-owned glossary is the core
value proposition of both apps, but the implementation currently lives
only in the romaco-scriptor fork (`lib/translation-glossary.js`,
glossary/TM tables, do-not-translate masking, prompt blocks, TM lookups
in translate/file/live paths). Keeping it fork-only guarantees drift and
double maintenance. Decision 2026-07-16: upstream it.

## Decisions Captured

- Port from romaco-scriptor: `lib/translation-glossary.js` (incl. the
  batched `lookupTMBatch`), `lib/translation-glossary-validation.js`,
  glossary/TM schema (`translation_glossary`, `translation_memory`),
  glossary settings UI, seeding script, and the glossary/TM wiring in
  `pages/api/translate.js`, `pages/api/translate/file.js` and the live
  vexa-bridge delta translation.
- The Romaco pharma seed glossary stays fork-only; upstream ships an
  empty glossary plus a generic example seed.
- Glossary is org-scoped (same permission model as in Romaco).
- Romaco later rebases onto the upstream module — fork keeps only its
  seed data and any pharma-specific validation rules.

## What Changes

- New libs + db-init migrations (copied, adapted import paths).
- `translate` / `translate/file` / vexa-bridge use glossary+TM exactly as
  in Romaco (mask do-not-translate terms, prompt block, TM cache with
  batched lookup, store-after-translate).
- Settings: glossary management tab (CRUD, CSV import) ported.
- Tests ported: `translation-glossary.test.mjs` and related.

## Impact

- No behavior change for orgs without glossary entries.
- Slight cost reduction from TM hits on repeated content.
