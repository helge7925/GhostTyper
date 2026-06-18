# Change: Improve Dateien, Workspace-Wissen, Aufgaben, and Chat RAG

## Why

GhostTyper has grown beyond audio transcription. The current `Historie`/`transcriptions` view mixes recordings, meetings, OCR results, translations, table analyses, and chat context without a clear product model. Users need a unified `Dateien` area, private and shared workspace files, document-grounded chat with citations, and task extraction from transcripts.

OpenWebUI provides useful reference patterns: workspace knowledge bases, focused retrieval vs full-context attachments, citations, conversation organization, search, and follow-up prompts. GhostTyper should adopt those patterns in a way that fits its existing transcription/OCR/meeting processing flows.

## Decisions Captured

- The library navigation label SHALL be `Dateien`.
- GhostTyper SHALL support private files in addition to workspace-shared files.
- Embeddings SHALL be generated via the Cortecs API and stored in GhostTyper; pgvector SHALL be optional infrastructure for accelerated vector search, not a blocker for the MVP.
- Extracted transcript tasks SHALL be directly assigned to workspace members when a reliable match is possible.
- Chat context SHALL attach automatically when the user opens chat from a document, while still allowing manual context changes.

## What Changes

- Introduce a canonical `documents` layer over existing transcription/OCR/translation records.
- Replace the user-facing `Historie` mental model with `Dateien`.
- Add document visibility: `private` and `workspace`.
- Add workspace knowledge bases with directories, attached documents, retrieval modes, and indexing status.
- Add chunking/indexing for transcriptions, OCR, translations, and workspace files.
- Add transcript task extraction with evidence, source links, member assignment, and review flow.
- Upgrade chat with streaming responses, citations, multiple context attachments, better message actions, and document-aware prompts.

## Out Of Scope For MVP

- Native desktop sync daemon.
- External connectors such as Confluence, Jira, Google Drive, or S3.
- pgvector as a hard infrastructure dependency; stored embeddings remain in scope.
- Agentic filesystem-like `kb_exec` tools.
- External task-system integrations.
- Public file sharing beyond existing share-link mechanisms.

## Success Criteria

- Users can find all relevant work under `Dateien` regardless of source type.
- Users can keep a file private or share it with the workspace.
- Users can create a workspace knowledge base and add existing files to it.
- Indexed documents have stored embeddings generated through Cortecs.
- Chat responses over attached documents include clickable citations.
- Chat responses stream progressively.
- Transcript tasks can be extracted, reviewed, assigned to workspace members, and linked back to transcript evidence.
