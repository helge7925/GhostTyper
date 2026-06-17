# Status: Dateien, Workspace-Wissen, Aufgaben, Chat RAG

Last updated: 2026-06-17

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
- Unit tests and lint pass after the indexing/retrieval changes.

## Verified

- `npm test` passed with 149 tests (includes 5 new `runAutoIndex` orchestration tests covering missing-key skip, id resolution, error swallowing, and null guards).
- `npm run lint` passed with no warnings or errors.
- JSON/i18n validation passed earlier in this change set.
- DB SQL smoke passed against the local Dev Postgres container using the Dev-Compose database URL.
- Documents list/detail queries with index status were smoke-tested against local Dev Postgres.

## Blocked

- `.env` does not define `DATABASE_URL`; only `.env.example` does.
- Local smoke commands still need an explicit `DATABASE_URL` environment variable unless `.env` is updated.

## Next Steps

1. Implement Workspace-Wissen tables, APIs, and UI (builds on `retrieveDocumentSources` for knowledge-scoped retrieval).
2. Implement Aufgaben extraction, member matching, task APIs, and task UI.
3. Chat polish: copy/regenerate/edit actions, follow-up prompt generation, knowledge-base attachments in the context bar.
4. Add DB-level retrieval tests for access filtering.

## Done since last update

- Automatic indexing after upload/OCR/text/meeting creation and on transcript edits/speaker assignment (translations excluded by design).
- Backfill endpoint for pre-existing documents without a completed index job (`POST /api/admin/documents/backfill-index`).
- Streaming chat: `POST /api/chat/stream` SSE endpoint sharing `lib/chat-service` with the non-streaming turn, client-side token streaming with non-streaming fallback, and source/citation chips rendered in `ChatMessage`. Streaming-shape unit tests added.
- Markdown/OCR-aware chunker (`chunkMarkdown`, heading-scoped) wired into `buildDocumentChunks`, and a general access-filtered retrieval endpoint `POST /api/retrieval/query` (refactored shared core `rankDocumentChunks`). Chunker unit tests added.
- Multi-document chat context: `chat_context_items` table, `GET/POST/DELETE /api/chat/context` (access-checked), retrieval now unions the conversation's origin document with attached context items, and a `ChatContextBar` header UI with remove + search-based add picker.

## Notes

- The fallback detail route in cards still points to `/documents/${id}` when no transcription exists; a dedicated document detail page is not implemented yet.
- Retrieval currently uses the active conversation reference only; full knowledge-base scoped retrieval is still pending.
- The current retrieval path can work without `pgvector`, but large workspaces will eventually need indexed vector search or a tighter candidate strategy.
