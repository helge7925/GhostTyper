# Design: Dateien, Workspace-Wissen, and Chat RAG

> **Note (2026-06-18):** The task-extraction design below (the `tasks` table,
> assignment matching, the `Aufgaben erkennen` action, the `/tasks` page, and the
> `task.*` permissions / `/api/tasks` endpoints) was implemented and then
> reverted (commit `83f09a7`), replaced by the `action_items` analysis template.
> Those sections are retained as historical design context only and do not
> reflect the current codebase.

## Overview

This change introduces a product-level document model while preserving existing processing pipelines. The current `transcriptions` table remains the processing/detail table. A new `documents` table becomes the library and knowledge entry point.

## Embeddings And pgvector

GhostTyper should generate embeddings through the Cortecs API and store them for every indexed document chunk. An embedding is a numeric vector representation of text meaning. At query time, GhostTyper embeds the user question, compares it to stored chunk embeddings, and retrieves semantically similar chunks. Example: a query for `Welche Fristen wurden genannt?` can retrieve chunks that say `bis Ende Juni einreichen`, even if the exact query words do not appear.

`pgvector` is a PostgreSQL extension that adds a native `vector` column type and similarity indexes. It is useful for fast vector search, but it is not required to store embeddings. For the MVP, GhostTyper can store embeddings in a regular `DOUBLE PRECISION[]` column and rerank a candidate set in application code. This keeps the feature deployable on the current Postgres setup and allows a later pgvector migration for speed.

Benefits:

- Better semantic retrieval for paraphrased questions.
- Stronger RAG quality across large knowledge bases.
- Keeps vectors in Postgres instead of adding a separate vector database.
- Uses the existing Cortecs API/provider setup.

Costs and risks:

- pgvector acceleration requires enabling the Postgres extension in Docker/prod.
- Requires an embedding model endpoint and indexing jobs.
- Changing embedding models requires re-indexing.
- Adds operational complexity.

Decision: MVP uses Cortecs embeddings stored in Postgres plus full-text search as a fallback/candidate generator. Store vectors in a separate `document_chunk_embeddings` table using `DOUBLE PRECISION[]`. Add pgvector later by adding an indexed vector column or converting the storage table when the extension is available.

## Data Model

### documents

Canonical library item.

Columns:

- `id BIGSERIAL PRIMARY KEY`
- `organization_id BIGINT NOT NULL REFERENCES organizations(id)`
- `owner_user_id INTEGER NOT NULL REFERENCES users(id)`
- `visibility VARCHAR(20) NOT NULL DEFAULT 'private' CHECK IN ('private','workspace')`
- `source_type VARCHAR(40) NOT NULL`
- `title VARCHAR(255) NOT NULL`
- `mime_type VARCHAR(120)`
- `file_size INTEGER`
- `status VARCHAR(50) NOT NULL DEFAULT 'ready'`
- `folder_id BIGINT NULL REFERENCES folders(id) ON DELETE SET NULL`
- `is_favorite BOOLEAN NOT NULL DEFAULT false`
- `tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`
- `summary TEXT`
- `text_preview TEXT`
- `transcription_id INTEGER NULL REFERENCES transcriptions(id) ON DELETE CASCADE`
- `created_at TIMESTAMPTZ DEFAULT NOW()`
- `updated_at TIMESTAMPTZ DEFAULT NOW()`

`source_type` values:

- `audio_transcription`
- `meeting`
- `ocr`
- `translation`
- `data_table`
- `text`
- `workspace_file`

Default visibility:

- Manual uploads, OCR, text, translation: `private`.
- Remote meetings: `workspace` by default because they are workspace activities.
- Existing rows backfilled as `workspace` to preserve current org-wide behavior, unless a migration option chooses private.

### folders

Existing folder table should become org/document aware.

Add columns:

- `parent_id BIGINT NULL REFERENCES folders(id) ON DELETE CASCADE`
- `visibility VARCHAR(20) NOT NULL DEFAULT 'workspace' CHECK IN ('private','workspace')`

Constraints:

- Unique folder name per `organization_id`, `parent_id`, `visibility`, and owner for private folders.
- Existing user ownership FK from transcriptions should not govern new document library access.

### knowledge_bases

Workspace-scoped collections for retrieval.

Columns:

- `id BIGSERIAL PRIMARY KEY`
- `organization_id BIGINT NOT NULL REFERENCES organizations(id)`
- `name VARCHAR(160) NOT NULL`
- `description TEXT`
- `created_by INTEGER REFERENCES users(id)`
- `visibility VARCHAR(20) NOT NULL DEFAULT 'workspace'`
- `created_at TIMESTAMPTZ DEFAULT NOW()`
- `updated_at TIMESTAMPTZ DEFAULT NOW()`

### knowledge_directories

Directory tree inside a knowledge base.

Columns:

- `id BIGSERIAL PRIMARY KEY`
- `knowledge_base_id BIGINT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE`
- `parent_id BIGINT NULL REFERENCES knowledge_directories(id) ON DELETE CASCADE`
- `name VARCHAR(160) NOT NULL`
- `position INTEGER DEFAULT 0`

### knowledge_items

Links documents into a knowledge base.

Columns:

- `id BIGSERIAL PRIMARY KEY`
- `knowledge_base_id BIGINT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE`
- `document_id BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE`
- `directory_id BIGINT NULL REFERENCES knowledge_directories(id) ON DELETE SET NULL`
- `retrieval_mode VARCHAR(20) NOT NULL DEFAULT 'focused' CHECK IN ('focused','full_context','off')`
- `created_by INTEGER REFERENCES users(id)`
- `created_at TIMESTAMPTZ DEFAULT NOW()`

### document_chunks

Citation-ready retrieval units.

Columns:

- `id BIGSERIAL PRIMARY KEY`
- `organization_id BIGINT NOT NULL REFERENCES organizations(id)`
- `document_id BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE`
- `chunk_index INTEGER NOT NULL`
- `content TEXT NOT NULL`
- `content_tsv TSVECTOR`
- `metadata JSONB NOT NULL DEFAULT '{}'::jsonb`
- `token_estimate INTEGER DEFAULT 0`
- `created_at TIMESTAMPTZ DEFAULT NOW()`

Metadata examples:

- Transcripts: `start_seconds`, `end_seconds`, `speaker`, `segment_ids`.
- OCR/PDF: `page`, `line_start`, `line_end`, `char_start`, `char_end`.
- Translation: `section`, `source_language`, `target_language`.

### document_chunk_embeddings

Stores Cortecs-generated embeddings for semantic retrieval.

Columns:

- `id BIGSERIAL PRIMARY KEY`
- `chunk_id BIGINT NOT NULL REFERENCES document_chunks(id) ON DELETE CASCADE`
- `organization_id BIGINT NOT NULL REFERENCES organizations(id)`
- `provider VARCHAR(40) NOT NULL DEFAULT 'cortecs'`
- `model VARCHAR(120) NOT NULL`
- `dimensions INTEGER NOT NULL`
- `embedding DOUBLE PRECISION[] NOT NULL`
- `embedding_hash VARCHAR(64) NOT NULL`
- `created_at TIMESTAMPTZ DEFAULT NOW()`

Indexes:

- unique `(chunk_id, provider, model)`
- btree `(organization_id, model)`

Future pgvector path:

- Add nullable `embedding_vector vector(n)` to `document_chunk_embeddings`, backfill from `embedding`, and create an IVFFLAT/HNSW index.

### document_index_jobs

Tracks async indexing.

Columns:

- `id BIGSERIAL PRIMARY KEY`
- `document_id BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE`
- `status VARCHAR(30) NOT NULL DEFAULT 'queued'`
- `error TEXT`
- `started_at TIMESTAMPTZ`
- `finished_at TIMESTAMPTZ`
- `created_at TIMESTAMPTZ DEFAULT NOW()`

### tasks

Transcript-derived action items.

Columns:

- `id BIGSERIAL PRIMARY KEY`
- `organization_id BIGINT NOT NULL REFERENCES organizations(id)`
- `document_id BIGINT REFERENCES documents(id) ON DELETE SET NULL`
- `transcription_id INTEGER REFERENCES transcriptions(id) ON DELETE SET NULL`
- `source_chunk_id BIGINT REFERENCES document_chunks(id) ON DELETE SET NULL`
- `title VARCHAR(255) NOT NULL`
- `description TEXT`
- `assignee_text VARCHAR(255)`
- `assignee_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`
- `due_date DATE`
- `priority VARCHAR(20) DEFAULT 'medium'`
- `status VARCHAR(20) DEFAULT 'proposed'`
- `confidence NUMERIC(4,3)`
- `evidence TEXT`
- `created_by INTEGER REFERENCES users(id)`
- `created_at TIMESTAMPTZ DEFAULT NOW()`
- `updated_at TIMESTAMPTZ DEFAULT NOW()`

### chat_context_items

Multiple context attachments per chat.

Columns:

- `id BIGSERIAL PRIMARY KEY`
- `conversation_id BIGINT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE`
- `context_type VARCHAR(30) NOT NULL CHECK IN ('document','knowledge_base','folder')`
- `document_id BIGINT NULL REFERENCES documents(id) ON DELETE CASCADE`
- `knowledge_base_id BIGINT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE`
- `folder_id BIGINT NULL REFERENCES folders(id) ON DELETE CASCADE`
- `retrieval_mode VARCHAR(20) NOT NULL DEFAULT 'focused'`
- `created_at TIMESTAMPTZ DEFAULT NOW()`

### chat_messages metadata

Add:

- `metadata JSONB NOT NULL DEFAULT '{}'::jsonb`

Used for:

- `citations`
- `retrieval_results`
- `followups`
- `stream_status`
- `regenerated_from_message_id`

## Access Control

Document read access:

- `workspace`: any workspace role with `document.read`.
- `private`: owner only, plus owner/admin if admin visibility is explicitly enabled later.

Document write access:

- Owner can edit private files.
- Members/admins/owners can create files.
- Workspace-shared file edits require `document.write`.
- Deletes require owner for private files or `document.delete` for workspace files.

New permissions:

- `document.read`
- `document.write`
- `document.delete`
- `knowledge.read`
- `knowledge.write`
- `knowledge.delete`
- `task.read`
- `task.write`
- `task.delete`
- `chat.read`
- `chat.write`
- `chat.delete`

## Retrieval Design

MVP retrieval uses a hybrid approach: generate a Cortecs embedding for the user query, collect accessible candidate chunks via knowledge/document scope and full-text filters, then rank candidates by cosine similarity against stored embeddings. Postgres full-text ranking remains a fallback and tie-breaker.

Pipeline:

1. Resolve active chat context items.
2. Expand context to allowed document IDs.
3. For `full_context`, inject whole document if below configured character cap.
4. For `focused`, fetch candidates from attached documents/knowledge bases.
5. Embed the user query through Cortecs.
6. Rank candidate chunks by cosine similarity where embeddings exist.
7. Fall back to full-text ranking for chunks without embeddings.
8. Build numbered source blocks `[S1]`, `[S2]`, etc.
9. Instruct model to cite source IDs for document-grounded claims.
10. Persist citations in `chat_messages.metadata`.

Initial retrieval limits:

- Top 8 chunks.
- Candidate pool up to 200 chunks before semantic reranking.
- Max 20,000 characters total injected retrieval context.
- Max full-context document length 40,000 characters unless model context settings allow more.

## Chat Streaming

Add `POST /api/chat/stream` using Server-Sent Events.

Event types:

- `context`: retrieval sources selected before model call.
- `message_start`: assistant placeholder created.
- `token`: text delta.
- `citations`: final citation metadata.
- `usage`: token/cost usage.
- `message_done`: persisted assistant message.
- `error`: terminal error.

If Cortecs streaming is unavailable, the endpoint may return a full response as one or more synthetic `token` events while preserving the same UI path.

## Automatic Chat Context

When a user opens chat from a document detail page:

- Create or reuse a conversation for that document.
- Add a `chat_context_items` row for the document automatically.
- Default retrieval mode: `focused`.
- Show the attached document as a chip in the chat header.
- Allow user to remove it or add more context.

## Task Assignment Matching

Workspace member assignment should use a deterministic matching pass before storing tasks.

Matching inputs:

- Segment speaker name.
- Mentioned person name.
- Mentioned email address.
- Workspace member `name` and `email`.

Matching rules:

- Exact email match: assign immediately, high confidence.
- Exact normalized full-name match: assign, high confidence.
- Unique partial-name match: assign, medium confidence.
- Ambiguous match: leave `assignee_user_id` null and store `assignee_text`.

The UI must show confidence and allow manual reassignment before accepting proposed tasks.

## API Surface

Documents:

- `GET /api/documents`
- `POST /api/documents`
- `GET /api/documents/[id]`
- `PATCH /api/documents/[id]`
- `DELETE /api/documents/[id]`
- `POST /api/documents/[id]/index`
- `GET /api/documents/[id]/index-status`

Knowledge:

- `GET /api/knowledge-bases`
- `POST /api/knowledge-bases`
- `GET /api/knowledge-bases/[id]`
- `PATCH /api/knowledge-bases/[id]`
- `DELETE /api/knowledge-bases/[id]`
- `POST /api/knowledge-bases/[id]/documents`
- `DELETE /api/knowledge-bases/[id]/documents/[documentId]`
- `POST /api/knowledge-bases/[id]/directories`
- `PATCH /api/knowledge-bases/[id]/directories/[directoryId]`
- `DELETE /api/knowledge-bases/[id]/directories/[directoryId]`

Retrieval:

- `POST /api/retrieval/query`

Tasks:

- `GET /api/tasks`
- `POST /api/transcriptions/[id]/extract-tasks`
- `PATCH /api/tasks/[id]`
- `DELETE /api/tasks/[id]`
- `POST /api/tasks/bulk`

Chat:

- `POST /api/chat/stream`
- `POST /api/chat/context`
- `DELETE /api/chat/context/[id]`
- `PATCH /api/chat/messages/[id]`
- `POST /api/chat/messages/[id]/regenerate`

## UI Plan

Navigation:

- Rename `Historie` to `Dateien`.
- Route can remain `/transcriptions` in phase 1, but UI label and page title should become `Dateien`.
- Later introduce `/documents` and redirect old route.

Dateien page:

- Filters: visibility, type, status, owner, tags, date, favorite.
- Search: title, text, analysis, tags.
- Views: list and grid.
- Bulk actions: move, tag, visibility, add to knowledge, delete.
- Private/workspace badge on each item.

Workspace Wissen page:

- Knowledge-base list.
- Knowledge-base detail with directories and documents.
- Add existing Datei, upload new file, set retrieval mode.
- Index status visible per document.

Chat:

- Context chips in header.
- Source chips below assistant messages.
- Streaming answer area.
- Stop, copy, regenerate, edit user message, create task from answer.
- Suggested follow-up prompts after assistant messages.

Tasks:

- Transcription detail action: `Aufgaben erkennen`.
- Review modal for proposed tasks.
- Global `/tasks` page with filters.
- Source link jumps to transcript segment or document citation.

## Migration Strategy

1. Add schema without removing existing columns.
2. Backfill `documents` from `transcriptions`.
3. Dual-write new uploads/OCR/translations into `transcriptions` and `documents`.
4. Switch `Dateien` UI to `documents` API.
5. Add chunk indexing jobs and backfill chunks.
6. Enable chat citations and knowledge bases.
7. Add task extraction.
8. Remove or de-emphasize old transcriptions-list API only after parity.
