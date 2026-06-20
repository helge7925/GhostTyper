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
- [x] Add document audit events. *(Added `logAuditEvent()` calls for GET/PATCH/DELETE in `/api/documents`.)*

## 2. Dateien API

- [x] Implement `GET /api/documents` with filters and pagination.
- [x] Implement `GET /api/documents/[id]`.
- [x] Implement `PATCH /api/documents/[id]`.
- [x] Implement `DELETE /api/documents/[id]`.
- [x] Implement bulk document actions. *(Added `POST /api/documents/bulk` endpoint with delete/move/tag actions, UI buttons and dialogs in `/pages/transcriptions.js`.)*
- [ ] Add tests for private vs workspace access. *(Only DB-level tests exist in `tests/retrieval-access-db.test.mjs`; no API endpoint tests.)*
- [ ] Add tests for filters and full-text search. *(No tests found for `/api/documents` filter parameters.)*

## 3. Dateien UI

- [x] Rename navigation label to `Dateien`.
- [x] Replace transcriptions-list data source with documents API.
- [x] Add visibility badges and filters.
- [x] Add type filters and status filters.
- [x] Add tag display and tag editing.
- [x] Add bulk actions. *(Implemented with `POST /api/documents/bulk` endpoint and UI dialogs for delete/move/tag.)*
- [x] Add list/grid toggle.
- [ ] Preserve existing links to transcription details. *(Links to `/transcriptions/[id]` work, but `/transcriptions` now shows documents list instead of history; semantic shift needs review.)*

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
- [x] Implement `POST /api/retrieval/query`. (Access-filtered semantic search over the workspace index via `retrieveDocumentSources`; optional `documentIds` scope can only narrow, never widen, the caller's reach. Optional `knowledgeBaseId` scopes to a knowledge base via `retrieveKnowledgeSources`, honouring per-item focused/full_context/off retrieval modes.)
- [x] Add retrieval tests for access filtering and citation metadata. (Citation/heading metadata is covered by `chunkMarkdown` unit tests; access filtering is covered by DB-level smoke tests in `tests/retrieval-access-db.test.mjs` when `DATABASE_URL` is set.)

## 5. Workspace Wissen

- [x] Add `knowledge_bases` migration.
- [x] Add `knowledge_directories` migration.
- [x] Add `knowledge_items` migration. (Per-item `retrieval_mode` focused/full_context/off.)
- [x] Implement knowledge-base CRUD APIs. (`/api/knowledge` + `/api/knowledge/[id]`; org-scoped, knowledge.read/write/delete.)
- [x] Implement add/remove document APIs. (`/api/knowledge/[id]/items`; only workspace-visible documents may be added — private docs are rejected.)
- [x] Implement directory CRUD APIs. (`/api/knowledge/[id]/directories`.)
- [x] Add `Workspace Wissen` UI page. (`/knowledge` master-detail: list/create bases, add/remove documents via search picker, delete base; nav entry gated by `knowledge.read`.)
- [x] Add `Zu Workspace-Wissen hinzufügen` action in Dateien. (Per-card `AddToKnowledgeButton` for workspace documents, gated by `knowledge.write`.)
- [x] Add retrieval mode selector per knowledge item. (Per-item focused/full_context/off dropdown on the Workspace Wissen page, persisted via item PATCH.)
- [x] Add tests for private document restrictions in knowledge bases. (DB-level smoke test covers the workspace-visible document restriction when `DATABASE_URL` is set.)

## 6. Chat RAG and Streaming

- [x] Add `chat_context_items` migration. (Supports document and knowledge-base attachments.)
- [x] Add `chat_messages.metadata` migration.
- [x] Implement automatic document context when opening chat from a document. *(Added "Open Chat" button on `/documents/[id]` page that creates a new conversation with the document as context and redirects to chat.)*
- [x] Implement chat context add/remove APIs. (`GET/POST/DELETE /api/chat/context`, access-checked; retrieval unions the conversation's origin doc with attached context items.)
- [x] Implement `POST /api/chat/stream` SSE endpoint. (Shared `lib/chat-service` with the non-streaming turn; same retrieval/cost-lock/usage/citations; forwards Cortecs tokens as `delta`/`done`/`error` SSE events.)
- [x] Add non-streaming fallback behavior. (Client falls back to `POST /api/chat` when the stream endpoint is unavailable — network error or 404 — so nothing is double-persisted.)
- [x] Store citation metadata on assistant messages.
- [x] Render source chips in `ChatMessage`. (De-duplicated per document, linking to the transcription detail when available.)
- [x] Add context chips in chat header. (`ChatContextBar` shows attached documents with remove + a search-based add picker.)
- [x] Add knowledge-base attachments in chat context. (`chat_context_items` supports document and knowledge_base targets; ChatContextBar can attach/remove knowledge bases; conversation retrieval merges direct documents and knowledge-base scopes while honouring focused/full_context/off.)
- [x] Add copy/regenerate/edit actions.
- [x] Add follow-up prompt generation.
- [x] Add tests for streaming event shape. (`tests/chat-stream-utils.test.mjs` covers SSE line parsing + request-body shape.)
- [ ] Add tests for citations and source authorization. *(No tests found for citation extraction or source permission checks.)*

## 7. Aufgabenextraktion

- [x] Add `tasks` migration.
- [x] Implement member matching helper.
- [x] Implement task extraction prompt and JSON validation.
- [x] Implement `POST /api/transcriptions/[id]/extract-tasks`.
- [x] Implement task CRUD APIs.
- [x] Add task review UI in transcription detail.
- [x] Add global `/tasks` page.
- [x] Add source jump links to transcript/document locations. (Task source links jump to transcript segment anchors when `source_segment_ids` are present; otherwise to the transcript text section.)
- [x] Add tests for member assignment matching.
- [x] Add tests for proposed-task review flow. (Helper-level status transition/default coverage; API/UI-level coverage remains a follow-up.)

## 8. Verification

- [x] Run JSON/i18n validation.
- [x] Run unit tests.
- [x] Run lint.
- [x] Add migration smoke test.
- [x] Add manual QA checklist for `Dateien`, Knowledge, Chat, and Tasks. (`docs/qa-checklist-files-knowledge-chat-tasks.md`)
