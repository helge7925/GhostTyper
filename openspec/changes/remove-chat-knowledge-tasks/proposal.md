# Change: Remove Chat, Knowledge Bases (RAG) and Tasks

## Why

GhostTyper's strategy is to perfect a small set of core use cases:
transcription (upload / mic / tab audio), high-quality context-sensitive
translation, and OCR. The in-app chat (with RAG document index, chunking,
knowledge bases, citations, streaming) and the task-extraction feature are
the largest maintenance surface in the codebase while adding no
differentiation — general-purpose chat products do this better. Decision
taken 2026-07-16 with the product owner: **remove** (not freeze).

This change supersedes and closes `improve-files-knowledge-tasks-chat`,
which is archived without further implementation.

## Decisions Captured

- Chat (inline + streaming + regenerate), knowledge bases, the RAG
  document index (chunks, embeddings, citations) and Tasks SHALL be
  removed from UI, API and background workers.
- Existing DB tables (`chat_*`, `document_chunks`, `knowledge_*`,
  `tasks`) SHALL NOT be dropped automatically — removal ships as
  code-level removal first; a separate operator-run cleanup script drops
  tables after a deprecation window.
- The documents library itself (files, folders, favorites) SHALL stay —
  only its RAG indexing hooks are removed.
- Embedding-model plumbing (`CORTECS_EMBEDDING_MODEL`,
  `defaultEmbeddingModel`) SHALL be removed with the RAG index, unless
  another consumer exists at implementation time.

## What Changes

- Remove pages: `pages/chat.js`, `pages/knowledge.js`, task views.
- Remove API routes: `pages/api/chat.js`, `pages/api/chat/**`,
  `pages/api/knowledge*`, `pages/api/tasks*`.
- Remove libs: `lib/document-index.js`, `lib/chat-stream-utils.js`,
  chat/task utilities, `autoIndexDocument` hook in
  `lib/transcription-worker.js`.
- Remove related tests, i18n keys, nav entries, docs sections.
- Add `scripts/drop-chat-knowledge-tables.js` (operator-run, guarded).

## Impact

- Users lose in-app chat and task extraction (communicated in CHANGELOG).
- Known defect that dies with this code: chat routes hold the per-user
  budget advisory lock through whole completions/streams.
- Romaco Scriptor fork is unaffected (never shipped these features).
