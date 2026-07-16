# Tasks: Remove Chat, Knowledge Bases and Tasks

## ⚠️ Do NOT remove (similar names, different features)

- `lib/gdpr-chat-poster.js`, `lib/share-chat-poster.js` — these post
  into the MEETING chat via Vexa (GDPR notice / share link). Keep.
- `pages/api/knowledge-prep/**`, `components/KnowledgePrepWorkspace.js`
  — "Datentabelle aus Text" feature. Keep.
- The documents library itself (`pages/documents`, `lib/documents.js`,
  `pages/api/documents/**` minus index-hooks). Keep.
- Tasks feature code was ALREADY removed in an earlier change; only the
  `tasks` DB table remains → goes into the drop script only.

## 1. Remove files (verified inventory, 2026-07-16)

- [ ] Pages: `pages/chat.js`, `pages/knowledge.js`
- [ ] API: `pages/api/chat.js`, `pages/api/chat/` (context.js,
      conversations.js, messages/, regenerate.js, stream.js, upload.js),
      `pages/api/knowledge/`
- [ ] Libs: `lib/chat-actions-utils.js`, `lib/chat-service.js`,
      `lib/chat-stream-utils.js`, `lib/document-index.js`,
      `lib/document-index-utils.js`, `lib/knowledge-utils.js`,
      `lib/knowledge.js`
- [ ] Components: `AddToKnowledgeButton.js`, `ChatContextBar.js`,
      `ChatInput.js`, `ChatMessage.js`, `ChatSidebar.js`,
      `ChatSourcePicker.js`
- [ ] Tests: `chat-actions-utils`, `chat-citations`,
      `chat-stream-utils`, `document-index-utils`, `knowledge-utils`,
      `retrieval-access-db` (all `.test.mjs`)

## 2. Unwire references

- [ ] `lib/transcription-worker.js`: remove `autoIndexDocument` import +
      call.
- [ ] Nav/sidebar, command palette, i18n keys (`chat.*`, `knowledge.*`),
      onboarding mentions.
- [ ] `pages/api/organizations/integrations/cortecs/test.js`: replace
      `buildCortecsBody` (lives in chat-stream-utils) with an inline
      body — see romaco-scriptor's version of this file for the exact
      replacement.
- [ ] Embedding config (`CORTECS_EMBEDDING_MODEL`,
      `defaultEmbeddingModel` in settings-service/cortecs endpoint):
      remove after `grep` confirms no non-RAG consumer.
- [ ] Sweep: `grep -rn "chat-service\|chat-stream\|document-index\|knowledge" lib pages components tests` must
      return only the keep-list above.

## 3. Data lifecycle

- [ ] db-init: stop creating `chat_*`, `document_chunks`,
      `knowledge_*`, `tasks` tables for fresh installs.
- [ ] `scripts/drop-chat-knowledge-tables.js`: dry-run default,
      `--apply` executes, logs audit event, drops the tables above.

## 4. Definition of Done

- [ ] `npm test` and `npm run lint` green.
- [ ] Fresh `docker compose` boot: no missing-table/import errors.
- [ ] Manual smoke: upload → transcribe → analyze → documents library →
      translate all work; nav shows no chat/knowledge entries.
- [ ] CHANGELOG + README updated; `improve-files-knowledge-tasks-chat`
      moved to `openspec/changes/archive/`.
