# Status: Dateien, Workspace-Wissen, Chat RAG

Last updated: 2026-06-28

> **Scope note:** The Aufgabenextraktion (task) capability was built and then
> reverted on 2026-06-18 (commit `83f09a7`), replaced by the `action_items`
> analysis template (commit `ef5ad67`). All task-related references below are
> historical; the feature is no longer in the codebase.

## Current State

- OpenSpec proposal, design, task list, and delta specs exist for the change.
- The user-facing navigation/product term is `Dateien` instead of `Historie`.
- A document-library foundation exists with `documents`, `document_chunks`, `document_chunk_embeddings`, and `document_index_jobs` migrations in `lib/db-init.js`.
- Existing transcriptions are backfilled into `documents` by the additive migration.
- Upload, OCR, text/table generation, translation, and meeting creation dual-write document rows.
- `/api/documents` and `/api/documents/[id]` support list, read, patch, and delete flows.
- The `Dateien` list uses the Documents API and shows document-aware metadata.
- Cortecs embeddings are stored as Postgres `DOUBLE PRECISION[]`; `pgvector` remains a later optimization, not an MVP blocker.
- `POST /api/documents/[id]/reindex` indexes a document into chunks and embeddings.
- `Dateien` shows index status/chunk count and offers a manual reindex action per document for users with `document.write`.
- Indexing now runs automatically (best-effort, never blocking) after audio upload (in the transcription worker), OCR, text/table creation, and meeting completion, plus a re-index on transcript edits and speaker assignment. Translations are intentionally excluded (the DB only stores a placeholder status string, not the translated body). The shared `autoIndexDocument` helper resolves the document from the transcription, skips silently when no Cortecs key is configured, and swallows/logs failures so the user flow is never blocked.
- A backfill endpoint `POST /api/admin/documents/backfill-index` indexes pre-existing documents that have no completed index job yet, in bounded batches (default 25, max 100), optionally scoped to one organization, with a `dryRun` mode. Shared-secret protected via `BACKFILL_API_SECRET` (mirrors the Vexa reconcile endpoint); safe to run repeatedly from a cron. Cortecs config is resolved per (org, owner) and cached per run.
- Chat now retrieves indexed chunks for the active conversation context, injects source blocks, and stores retrieval metadata on assistant messages.
- Chat context supports attaching Workspace-Wissen knowledge bases as well as individual documents. Attached knowledge bases are included in conversation retrieval and honour per-item focused/full_context/off modes.
- ~~Aufgabenextraktion exists~~ **REVERTED** (2026-06-18, commit `83f09a7`): the `tasks` table, member matching, `extract-tasks` endpoint, task CRUD APIs, and `/tasks` page were removed and replaced by the `action_items` analysis template.
- Chat polish is implemented with copy/edit/regenerate actions and deterministic follow-up prompt chips on the latest assistant response.
- Document operations emit audit events (`document.read/update/delete` and the bulk variants); bulk delete/move/tag are backed by `POST /api/documents/bulk`; `/documents/[id]` has an "Open Chat" action that opens a chat with the document auto-attached as context. (Implemented via PR #15.)
- Dateien polish now includes type/status/visibility/favorite filters, tag display/editing, list/grid toggle, and bulk delete/move/tag.
- Non-transcription documents now have a dedicated `/documents/[id]` detail page with metadata, preview, tags, reindex and delete actions.
- Retrieval candidate loading now uses a bounded full-text pre-ranking before embedding rerank, which reduces random chunk selection in larger workspaces without requiring pgvector.
- `npm run lint` uses the ESLint CLI instead of deprecated `next lint`.
- Unit tests and lint pass after the indexing/retrieval changes.

## Verified

- `npm test` passed with 173 tests and 4 DB tests skipped without `DATABASE_URL` (includes chat knowledge-context scope merge, chat follow-up, and task matching/normalization tests).
- DB access/review tests passed against local Dev Postgres with explicit `DATABASE_URL` (private Knowledge restrictions, retrieval private-document filtering, and task review status transitions).
- `npm run lint` passed with no warnings or errors.
- `npm run build` passed. Remaining warnings are existing operational warnings (`_app.getInitialProps` static optimisation opt-out and Chromium `--localstorage-file`).
- JSON/i18n validation passed earlier in this change set.
- DB SQL smoke passed against the local Dev Postgres container using the Dev-Compose database URL.
- Chat knowledge-context migration SQL order was validated in a temporary Postgres schema with rollback.
- Documents list/detail queries with index status were smoke-tested against local Dev Postgres.

## Blocked

*(None - `DATABASE_URL` is now defined in `.env` as of 2026-06-19.)*

## Next Steps (remaining open points)

All 81 implementation/test/review tasks are complete. The core features
(audit events, bulk actions, Open-Chat auto-context) and their tests landed via
PR #15; the OpenSpec cleanup (ui-polish archived, reverted task capability
removed, validation fixed, semantic-shift review) landed in this change.
Remaining items are operational, not blockers:

1. Run manual QA from `docs/qa-checklist-files-knowledge-chat-tasks.md` on localhost.
2. Consider pgvector for indexed vector search once workspace data grows beyond the current bounded candidate strategy.
3. Archive this change via `openspec archive improve-files-knowledge-tasks-chat` once it ships.

## Done since last update

- Automatic indexing after upload/OCR/text/meeting creation and on transcript edits/speaker assignment (translations excluded by design).
- Backfill endpoint for pre-existing documents without a completed index job (`POST /api/admin/documents/backfill-index`).
- Streaming chat: `POST /api/chat/stream` SSE endpoint sharing `lib/chat-service` with the non-streaming turn, client-side token streaming with non-streaming fallback, and source/citation chips rendered in `ChatMessage`. Streaming-shape unit tests added.
- Markdown/OCR-aware chunker (`chunkMarkdown`, heading-scoped) wired into `buildDocumentChunks`, and a general access-filtered retrieval endpoint `POST /api/retrieval/query` (refactored shared core `rankDocumentChunks`). Chunker unit tests added.
- Multi-document chat context: `chat_context_items` table, `GET/POST/DELETE /api/chat/context` (access-checked), retrieval now unions the conversation's origin document with attached context items, and a `ChatContextBar` header UI with remove + search-based add picker.
- Workspace-Wissen data + APIs (slice 1): `knowledge_bases`/`knowledge_directories`/`knowledge_items` migrations, `lib/knowledge` service, and CRUD endpoints (`/api/knowledge`, `/api/knowledge/[id]`, `.../items`, `.../directories`). Only workspace-visible documents can be added (private docs rejected); items carry a focused/full_context/off retrieval mode.
- Workspace-Wissen UI (slice 2): `/knowledge` master-detail page (create/list/delete bases, add/remove documents via a workspace-only search picker, per-item retrieval-mode selector) and a `knowledge.read`-gated nav entry.
- Workspace-Wissen retrieval + Dateien action (slice 3): `retrieveKnowledgeSources` scopes retrieval to a knowledge base honouring focused/full_context/off (full_context injects whole documents ahead of chunk-ranked focused ones), exposed via `knowledgeBaseId` on `/api/retrieval/query`; an `AddToKnowledgeButton` adds workspace documents to a base directly from Dateien.
- Chat knowledge-base context: `chat_context_items` now supports `context_type=document|knowledge_base`; `/api/chat/context` can list/add/remove both types; `ChatContextBar` can search files or knowledge bases; conversation retrieval merges direct documents with attached knowledge-base scopes.
- DB access tests for Knowledge restrictions and retrieval filtering (`tests/retrieval-access-db.test.mjs`). *(The task helper tests `tests/task-utils.test.mjs` were removed with the reverted task feature.)*
- ~~Aufgabenextraktion: `tasks` migration, task service, task CRUD APIs, Cortecs-backed extraction endpoint, member matching, transcription-detail review actions, global `/tasks` page, and segment-aware source links.~~ **Reverted 2026-06-18** — replaced by the `action_items` analysis template.
- Chat polish: copy, edit, regenerate, and follow-up prompt chips.
- Dateien polish: type/status/visibility/favorite filters, tags, bulk delete, and list/grid toggle.
- Manual QA checklist added at `docs/qa-checklist-files-knowledge-chat-tasks.md`.
- Follow-ups completed: DB task-review smoke tests, `/documents/[id]`, tighter retrieval candidates, and ESLint CLI lint script.

## Notes

- The current retrieval path can work without `pgvector`, but very large workspaces should eventually use indexed vector search.
