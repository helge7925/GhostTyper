# Tasks: Remove Chat, Knowledge Bases and Tasks

## ⚠️ Do NOT remove (similar names, different features)

- `lib/gdpr-chat-poster.js`, `lib/share-chat-poster.js` — these post
  into the MEETING chat via Vexa (GDPR notice / share link). Keep.
  (Verified untouched.)
- `pages/api/knowledge-prep/**`, `components/KnowledgePrepWorkspace.js`
  — "Datentabelle aus Text" feature. Keep. (Kept; unwired a stray
  `autoIndexDocument` hook in `pages/api/knowledge-prep/text.js`, see
  2. below.)
- The documents library itself (`pages/documents`, `lib/documents.js`,
  `pages/api/documents/**` minus index-hooks). Keep. (Kept; RAG-index
  hooks removed, see 2. below.)
- Tasks feature code was ALREADY removed in an earlier change; only the
  `tasks` DB table remains → goes into the drop script only. (Done.)

## 1. Remove files (verified inventory, 2026-07-16)

- [x] Pages: `pages/chat.js`, `pages/knowledge.js`
- [x] API: `pages/api/chat.js`, `pages/api/chat/` (context.js,
      conversations.js, messages/, regenerate.js, stream.js, upload.js),
      `pages/api/knowledge/`
- [x] Libs: `lib/chat-actions-utils.js`, `lib/chat-service.js`,
      `lib/chat-stream-utils.js`, `lib/document-index.js`,
      `lib/document-index-utils.js`, `lib/knowledge-utils.js`,
      `lib/knowledge.js`
- [x] Components: `AddToKnowledgeButton.js`, `ChatContextBar.js`,
      `ChatInput.js`, `ChatMessage.js`, `ChatSidebar.js`,
      `ChatSourcePicker.js`
- [x] Tests: `chat-actions-utils`, `chat-citations`,
      `chat-stream-utils`, `document-index-utils`, `knowledge-utils`,
      `retrieval-access-db` (all `.test.mjs`)
- [x] **Deviation (additions, not in the original inventory):** grep
      turned up three more files that exist solely as RAG-index hooks
      and had no other purpose, so they were removed too:
      `pages/api/retrieval/query.js` (semantic retrieval endpoint),
      `pages/api/admin/documents/backfill-index.js` (RAG backfill
      cron endpoint), `pages/api/documents/[id]/reindex.js` (reindex
      endpoint). Also removed `docs/qa-checklist-files-knowledge-chat-tasks.md`,
      a QA checklist exclusively for the removed features.

## 2. Unwire references

- [x] `lib/transcription-worker.js`: remove `autoIndexDocument` import +
      call.
- [x] **Deviation:** `autoIndexDocument` was also imported/called in
      three more places not listed in the spec (found via grep after
      deleting `lib/document-index.js` and checking for now-broken
      imports): `pages/api/ocr.js`, `pages/api/transcriptions/[id].js`,
      `pages/api/webhooks/vexa.js`, and `pages/api/knowledge-prep/text.js`
      (keep-list file). All four unwired the same way (import + call
      site removed; the underlying document upsert stays).
- [x] Nav/sidebar, command palette, i18n keys (`chat.*`, `knowledge.*`),
      onboarding mentions. Command palette had no chat/knowledge
      entries to remove. Additional UI entry points found and removed:
      `components/BottomNav.js` (chat tab), `components/DocumentEditor.js`
      ("chat with document" button), `pages/translate.js` ("chat with
      translation" button), `pages/transcriptions/[id].js` ("chat with
      transcript" link), `pages/documents/[id].js` (chat/reindex
      buttons + chunk count), `components/TranscriptionCard.js`
      (index-status badge, reindex button, AddToKnowledgeButton),
      `pages/transcriptions.js` (reindex/knowledge wiring + "Workspace
      Wissen" link), `lib/permissions.js` (`chat.*`/`knowledge.*`
      permission keys), `lib/api.js` (`reindexDocument`,
      `createChatConversation`, `addChatContextItem` client calls).
      i18n: removed `nav.chat`, `nav.knowledge`, `bottomNav.chat`,
      `editor.chatWithDocument`, and the whole `chatPage`/`knowledgePage`
      namespaces from both `messages/de.json` and `messages/en.json`.
      Kept `settings.integrations.cortecs.chatModelLabel` (generic
      Cortecs chat-model setting, used well beyond the removed chat
      feature — see embedding-config note below for the same
      reasoning applied to a config field).
- [x] `pages/api/organizations/integrations/cortecs/test.js`: replace
      `buildCortecsBody` (lives in chat-stream-utils) with an inline
      body — see romaco-scriptor's version of this file for the exact
      replacement. Diffed byte-for-byte identical to
      `romaco-scriptor/pages/api/organizations/integrations/cortecs/test.js`
      after the edit.
- [x] Embedding config (`CORTECS_EMBEDDING_MODEL`,
      `defaultEmbeddingModel` in settings-service/cortecs endpoint):
      remove after `grep` confirms no non-RAG consumer.
      `grep -rn "embeddingModel\|EMBEDDING" lib pages components`
      confirmed `lib/document-index.js` was the only real consumer
      (settings-service.js and the cortecs integration endpoint were
      just plumbing feeding it). Removed `DEFAULT_EMBEDDING_MODEL`
      from `lib/constants.js`, the `embeddingModel` field from
      `resolveCortecsConfig()` in `lib/settings-service.js`, and
      `defaultEmbeddingModel` handling from
      `pages/api/organizations/integrations/cortecs.js` (GET defaults +
      PUT field validation). `chatModel`/`defaultChatModel` was NOT
      touched — it's a separate, still-used generic Cortecs LLM model
      setting (translate, OCR, analysis, templates, knowledge-prep all
      depend on it).
- [x] Sweep: `grep -rn "chat-service\|chat-stream\|document-index\|knowledge" lib pages components tests` must
      return only the keep-list above. Returns zero matches now (the
      keep-list files use `sendBotChatMessage`/`buildShareChatMessage`,
      which don't match this pattern at all).
- [x] Additional sweep for now-broken imports (`autoIndexDocument`,
      `document-index`, the six deleted component names) — all clean.
      Also removed `chunk_count`/`index_job_*` LATERAL joins from
      `pages/api/documents/[id].js` and `pages/api/documents/index.js`
      (RAG-index metadata surfaced by the documents API; the documents
      library queries themselves were untouched).

## 3. Data lifecycle

- [x] db-init: stop creating `chat_*`, `document_chunks`,
      `knowledge_*`, `tasks` tables for fresh installs. Removed the
      whole contiguous DDL block in `lib/db-init.js` (previously lines
      436–622): `document_chunks`, `document_chunk_embeddings`,
      `document_index_jobs`, `tasks`, `chat_conversations`,
      `chat_messages`, `chat_context_items`, `knowledge_bases`,
      `knowledge_directories`, `knowledge_items`, plus their indexes
      and the `ALTER TABLE`/constraint migrations that only make sense
      once those tables exist. No `DROP TABLE` added to db-init —
      existing installs keep their tables untouched.
- [x] `scripts/drop-chat-knowledge-tables.js`: dry-run default,
      `--apply` executes, logs audit event, drops the tables above.
      Drops all ten tables listed above (children before parents, plus
      `CASCADE` as a safety net). Follows this repo's existing
      scripts/ convention (raw `pg` Pool, no import of the ESM
      `lib/*.js` modules — see header comment for why `lib/audit-log.js`
      isn't imported directly; the script writes the same-shaped
      `audit_log` row itself instead).

## 4. Definition of Done

- [x] `npm test` and `npm run lint` green. Test: 150 tests, 140 pass, 0
      fail, 10 skipped (down from 193/181/0/12 — the drop is exactly
      the six removed `.test.mjs` files' test counts; 0 failures
      throughout). Lint: 0 errors, the same 2 pre-existing
      `react-hooks/exhaustive-deps` warnings in `pages/transcriptions.js`
      as before this change (untouched, out of scope). Also ran
      `npm run build` (not required by the spec, but a stronger import-
      resolution check than lint) — compiles successfully, and the
      route manifest confirms `/chat`, `/knowledge`, `/api/chat*`,
      `/api/knowledge*`, `/api/retrieval/query`,
      `/api/documents/[id]/reindex`, `/api/admin/documents/backfill-index`
      are all gone while `/api/knowledge-prep/text` (keep-list) remains.
- [ ] Fresh `docker compose` boot: no missing-table/import errors. NOT
      run — no Docker/DB available in this sandbox. Static
      verification instead: `npm run build` succeeded (proves every
      import resolves) and `lib/db-init.js` was manually checked for
      dangling references to the removed table names (none found).
      Left as an open point for a human/CI check before merge.
- [ ] Manual smoke: upload → transcribe → analyze → documents library →
      translate all work; nav shows no chat/knowledge entries. NOT run
      — needs a live dev server with a real DB and Cortecs API key,
      outside this sandbox's toolset. `npm run build` + `npm test`
      cover the static/unit layer; left as an open point for manual QA
      before merge.
- [x] CHANGELOG + README updated; `improve-files-knowledge-tasks-chat`
      moved to `openspec/changes/archive/`. Added a `### Removed`
      entry to `CHANGELOG.md`; removed the chat/knowledge-base bullets
      from `README.md` and `README.de.md`. Moved the whole
      `improve-files-knowledge-tasks-chat/` directory (design.md,
      proposal.md, specs/, status.md, tasks.md) into
      `openspec/changes/archive/` via `git mv`.
