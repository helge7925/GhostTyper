# Status: Remove Chat, Knowledge Bases and Tasks

Last updated: 2026-07-16

## Current State

- **Implemented on branch `feat/remove-chat-knowledge-tasks`, 2026-07-16.**
  Branched from `chore/review-hardening-and-roadmap`. Not merged, not
  pushed. See `tasks.md` for the full per-item breakdown, including
  deviations noted inline.
- Supersedes `improve-files-knowledge-tasks-chat`, which has been moved
  to `openspec/changes/archive/improve-files-knowledge-tasks-chat/`.

## Summary

- 36 files removed (pages, API routes, libs, components, tests, plus
  three RAG-hook-only API endpoints and one QA doc that weren't in the
  original inventory but had no purpose beyond the removed features —
  see tasks.md section 1).
- 27 files edited to unwire references (nav, permissions, i18n,
  `autoIndexDocument` hooks — including three call sites the spec
  didn't list, found via the broken-import sweep — embedding config,
  documents-API RAG metadata, the Cortecs test-endpoint body).
- `lib/db-init.js` no longer creates the ten chat/knowledge/RAG-index/
  tasks tables for fresh installs; no tables were dropped for existing
  installs.
- New `scripts/drop-chat-knowledge-tables.js` (dry-run default,
  `--apply` to execute) for the operator-run cleanup after a
  deprecation window.
- `npm test`: 150 tests, 140 pass, 0 fail, 10 skipped (baseline was
  193/181/0/12; the delta is exactly the six deleted test files).
- `npm run lint`: 0 errors, 2 pre-existing warnings (unchanged,
  out of scope per the task brief).
- `npm run build`: compiles successfully; route manifest confirms all
  removed routes are gone and the `knowledge-prep` keep-list route
  remains.

## Deviations from the written spec

- Removed three additional API endpoints not in tasks.md's file
  inventory, because they exist solely as RAG-index hooks with no
  other function: `pages/api/retrieval/query.js`,
  `pages/api/admin/documents/backfill-index.js`,
  `pages/api/documents/[id]/reindex.js`.
- Unwired `autoIndexDocument` from three more call sites beyond
  `lib/transcription-worker.js`: `pages/api/ocr.js`,
  `pages/api/transcriptions/[id].js`, `pages/api/webhooks/vexa.js`,
  and from the keep-list file `pages/api/knowledge-prep/text.js`
  (the feature itself was untouched — only the dead import/call was
  removed).
- Removed `docs/qa-checklist-files-knowledge-chat-tasks.md` — a QA
  checklist exclusively for the removed features, not referenced from
  any living doc.
- Removed the `chunk_count`/`index_job_*` fields (LATERAL joins against
  `document_chunks`/`document_index_jobs`) from the two documents-list
  API endpoints (`pages/api/documents/[id].js`,
  `pages/api/documents/index.js`) — RAG-index metadata surfaced by the
  documents API, not the documents library itself.
- Removed reindex/chat/knowledge-base entry points from
  `components/TranscriptionCard.js`, `pages/transcriptions.js`,
  `pages/documents/[id].js`, `components/DocumentEditor.js`,
  `pages/translate.js`, `pages/transcriptions/[id].js`,
  `components/BottomNav.js` — none of these were named in tasks.md's
  "unwire references" list, but each held a live import or route to a
  file being deleted, so leaving them would have broken the build.
  `npm run build` confirmed no import is left dangling.

## Open points (deferred to human/CI review)

- **Fresh `docker compose` boot** was not exercised — no Docker/DB
  available in this sandbox. `npm run build` (stronger than lint for
  import resolution) succeeded, and `lib/db-init.js` was manually
  checked for dangling references to the removed table names (none
  found), but an actual fresh-install boot against a real empty
  Postgres has not been verified.
- **Manual smoke test** (upload → transcribe → analyze → documents
  library → translate; nav shows no chat/knowledge entries) was not
  run — needs a live dev server, a real DB, and a Cortecs API key,
  none of which were available here. Please run this before merge.
- The mobile bottom nav (`components/BottomNav.js`) is now four items
  instead of five (Chat removed, nothing added in its place). This is
  a pure removal, not a design decision about what (if anything)
  should fill the slot — flagging in case product wants to reconsider
  the mobile nav layout.
- The README "tests passing" badge (`README.md`/`README.de.md`, both
  say "139 passing") was already stale before this change (actual was
  181) and is left as-is — updating badge accuracy across the repo is
  out of scope for this change.
