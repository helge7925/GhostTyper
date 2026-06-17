# Tasks: Improve Dateien, Workspace-Wissen, Aufgaben, and Chat RAG

## 0. Foundation

- [x] Add OpenSpec change docs and confirm scope.
- [x] Fix chat POST duplicate-user-message prompt bug.
- [x] Add new permissions for documents, knowledge, tasks, and chat.
- [x] Add i18n label changes from `Historie` to `Dateien`.

## 1. Dateien Data Layer

- [x] Add `documents` table migration.
- [x] Add folder visibility and parent migration.
- [x] Add document access helper functions.
- [x] Backfill `documents` from existing `transcriptions`.
- [x] Dual-write document rows for audio uploads.
- [x] Dual-write document rows for OCR uploads.
- [x] Dual-write document rows for translations.
- [x] Dual-write document rows for text/table generation.
- [ ] Add document audit events.

## 2. Dateien API

- [x] Implement `GET /api/documents` with filters and pagination.
- [x] Implement `GET /api/documents/[id]`.
- [x] Implement `PATCH /api/documents/[id]`.
- [x] Implement `DELETE /api/documents/[id]`.
- [ ] Implement bulk document actions.
- [ ] Add tests for private vs workspace access.
- [ ] Add tests for filters and full-text search.

## 3. Dateien UI

- [x] Rename navigation label to `Dateien`.
- [x] Replace transcriptions-list data source with documents API.
- [x] Add visibility badges and filters.
- [ ] Add type filters and status filters.
- [ ] Add tag display and tag editing.
- [ ] Add bulk actions.
- [ ] Add list/grid toggle.
- [ ] Preserve existing links to transcription details.

## 4. Indexing and Retrieval

- [x] Add `document_chunks` migration.
- [x] Add `document_chunk_embeddings` migration using Cortecs embeddings stored as arrays.
- [x] Add `document_index_jobs` migration.
- [x] Implement transcript chunker using segments and timestamps.
- [x] Implement OCR/Markdown chunker using pages/headings/paragraphs. (`chunkMarkdown` splits on headings, records the heading in chunk metadata, and falls back to size-based splitting for oversized sections; used by `buildDocumentChunks` for non-segment documents.)
- [x] Implement translation/text chunker.
- [x] Implement indexing job runner.
- [x] Add manual reindex action and index status in `Dateien`.
- [x] Trigger indexing automatically after audio upload (worker), OCR, text/table creation, and meeting completion; re-index on transcript edits and speaker assignment. Translations are intentionally excluded (only a placeholder status string is stored in the DB, not the translated body). Best-effort via `autoIndexDocument` — never blocks the user flow.
- [x] Implement Cortecs embedding client and cosine reranker.
- [x] Backfill chunks for existing completed documents. (`POST /api/admin/documents/backfill-index`, shared-secret, bounded batches, idempotent — rebuilds chunks via `indexDocument`.)
- [x] Backfill embeddings for existing indexed chunks. (Same endpoint: `indexDocument` writes chunks + embeddings together, so the backfill covers both; documents without a completed index job are reprocessed.)
- [x] Implement `POST /api/retrieval/query`. (Access-filtered semantic search over the workspace index via `retrieveDocumentSources`; optional `documentIds` scope can only narrow, never widen, the caller's reach.)
- [ ] Add retrieval tests for access filtering and citation metadata. (Citation/heading metadata is covered by `chunkMarkdown` unit tests; access-filtering needs DB-level integration coverage — still open.)

## 5. Workspace Wissen

- [x] Add `knowledge_bases` migration.
- [x] Add `knowledge_directories` migration.
- [x] Add `knowledge_items` migration. (Per-item `retrieval_mode` focused/full_context/off.)
- [x] Implement knowledge-base CRUD APIs. (`/api/knowledge` + `/api/knowledge/[id]`; org-scoped, knowledge.read/write/delete.)
- [x] Implement add/remove document APIs. (`/api/knowledge/[id]/items`; only workspace-visible documents may be added — private docs are rejected.)
- [x] Implement directory CRUD APIs. (`/api/knowledge/[id]/directories`.)
- [x] Add `Workspace Wissen` UI page. (`/knowledge` master-detail: list/create bases, add/remove documents via search picker, delete base; nav entry gated by `knowledge.read`.)
- [ ] Add `Zu Workspace-Wissen hinzufügen` action in Dateien.
- [x] Add retrieval mode selector per knowledge item. (Per-item focused/full_context/off dropdown on the Workspace Wissen page, persisted via item PATCH.)
- [ ] Add tests for private document restrictions in knowledge bases. (Restriction enforced in `addKnowledgeItem`; DB-level test still open.)

## 6. Chat RAG and Streaming

- [x] Add `chat_context_items` migration. (Document-only for now; knowledge-base attachments are a later item.)
- [x] Add `chat_messages.metadata` migration.
- [ ] Implement automatic document context when opening chat from a document.
- [x] Implement chat context add/remove APIs. (`GET/POST/DELETE /api/chat/context`, access-checked; retrieval unions the conversation's origin doc with attached context items.)
- [x] Implement `POST /api/chat/stream` SSE endpoint. (Shared `lib/chat-service` with the non-streaming turn; same retrieval/cost-lock/usage/citations; forwards Cortecs tokens as `delta`/`done`/`error` SSE events.)
- [x] Add non-streaming fallback behavior. (Client falls back to `POST /api/chat` when the stream endpoint is unavailable — network error or 404 — so nothing is double-persisted.)
- [x] Store citation metadata on assistant messages.
- [x] Render source chips in `ChatMessage`. (De-duplicated per document, linking to the transcription detail when available.)
- [x] Add context chips in chat header. (`ChatContextBar` shows attached documents with remove + a search-based add picker.)
- [ ] Add copy/regenerate/edit actions.
- [ ] Add follow-up prompt generation.
- [x] Add tests for streaming event shape. (`tests/chat-stream-utils.test.mjs` covers SSE line parsing + request-body shape.)
- [ ] Add tests for citations and source authorization.

## 7. Aufgabenextraktion

- [ ] Add `tasks` migration.
- [ ] Implement member matching helper.
- [ ] Implement task extraction prompt and JSON validation.
- [ ] Implement `POST /api/transcriptions/[id]/extract-tasks`.
- [ ] Implement task CRUD APIs.
- [ ] Add task review UI in transcription detail.
- [ ] Add global `/tasks` page.
- [ ] Add source jump links to transcript/document locations.
- [ ] Add tests for member assignment matching.
- [ ] Add tests for proposed-task review workflow.

## 8. Verification

- [x] Run JSON/i18n validation.
- [x] Run unit tests.
- [x] Run lint.
- [x] Add migration smoke test.
- [ ] Add manual QA checklist for `Dateien`, Knowledge, Chat, and Tasks.
