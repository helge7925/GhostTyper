# Status: Upstream Translation Glossary + TM

Last updated: 2026-07-17

## Current State

- **Implemented on branch `feat/translation-glossary`, 2026-07-17.**
- Ported in one pass from romaco-scriptor branch
  `feat/translation-excellence` (HEAD 955e95d) — the finished two-tier
  system (personal + workspace tiers, TM with verified/last_used_at,
  DNT masking, quality guards, applied-terms metadata, CSV/TBX interop).
- Executed together with the same-named `personal-workspace-glossary`
  change (see its status.md).

## What landed

- Libs: `lib/translation-glossary.js`, `lib/translation-glossary-validation.js`,
  `lib/glossary-interop.js` (ported verbatim; the one Romaco-specific string
  in the TBX header was generalized to "GhostTyper glossary export").
- Schema: `translation_glossary` + `translation_memory` blocks in
  `lib/db-init.js` — fresh installs get the final two-tier schema; the
  ALTER/DROP-INDEX migration lines are idempotent (`IF EXISTS` /
  `IF NOT EXISTS`) so they are harmless on GhostTyper installs that have
  no glossary tables yet.
- API: `pages/api/glossary/{index,[id],suggestions,tm,export,import}.js`
  (org-scoped via `withOrgScope`; workspace writes gate on `org.settings`,
  reads on `org.read`). Client helpers added to `lib/api.js`.
- Translation path: `pages/api/translate.js`, `pages/api/translate/file.js`,
  `lib/vexa-bridge.js`, `lib/ai-service.js` (strictPlaceholders).
- UI: settings glossary tab (`components/settings/GlossaryPanel.js`),
  `components/TranslationTermPanel.js` on `pages/translate.js`, i18n de/en.
- Seed: `scripts/seed-translation-glossary.mjs` with a generic example set.

## Deviations / adaptations

- **Settings UI extracted to a component.** Romaco inlines ~500 lines of
  glossary state/handlers/JSX directly in `pages/settings.js`; GhostTyper's
  settings.js already uses a `components/settings/*Panel.js` convention and
  is otherwise hardcoded-German. The glossary UI was therefore ported into
  `components/settings/GlossaryPanel.js` (self-contained, uses the shared
  toast/confirm passed from the parent) and rendered from a new `glossary`
  tab. Functionally identical to the Romaco tab.
- **Permissions.** No `glossary.manage` permission was added: the routes
  gate on the existing `org.settings` (workspace CRUD / TM purge) and
  `org.read` (read + personal CRUD), exactly as in the source. Both already
  exist in `lib/permissions.js`.
- **i18n namespace.** Keys live under `settings.glossary.*` and
  `translatePage.terms.*` (matching the source's namespaces), plus
  `settings.tabs.glossary`. GhostTyper's settings panels are otherwise
  hardcoded German, but the new glossary UI is fully de/en localized via
  `useTranslations`.
- **Test file trim.** `tests/translation-glossary.test.mjs` dropped the two
  `bilingual-export` tests + import — `lib/bilingual-export.js` is a separate
  downstream feature, out of scope for these two changes and not part of the
  port inventory. All glossary/TM/guard/merge tests were kept.
- **PDF path OCR error string** in `translate/file.js` now reads
  "Kein Mistral API-Key für PDF-OCR konfiguriert." (Romaco wording),
  a cosmetic change from GhostTyper's prior "…für OCR…".

## Verification

- `npm test`: 216 tests, 206 pass / 10 skipped / 0 fail (+47 ported).
- `npm run lint`: 0 errors (2 pre-existing warnings in
  `pages/transcriptions.js`).
- `npm run build`: compiles (all pages incl. `/settings`, `/translate`,
  `/api/translate`, `/api/translate/file`).

## Open points

- **Manual end-to-end verification needs a live environment** (Postgres +
  a Cortecs API key): create a glossary entry, confirm inline + office/PDF
  translation honour it, and confirm a repeated translation hits the TM
  (no provider call logged for the cached segment). Not runnable in this
  porting pass.
- Romaco can later rebase its fork onto this upstream module, keeping only
  its pharma seed (`lib/romaco-glossary.js`) and any pharma-specific rules.
