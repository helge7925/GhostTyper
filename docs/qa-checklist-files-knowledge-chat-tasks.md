# QA Checklist: Dateien, Workspace-Wissen, Chat, Aufgaben

Date: 2026-06-18

## Dateien

- Open `/transcriptions` and verify list and grid view both render.
- Filter by type, visibility, status, and favorites; verify filters combine with search.
- Edit tags on a document and verify tags stay visible after reload.
- Select multiple documents and bulk-delete only after confirmation.
- Reindex a document and verify index status updates without blocking the UI.

## Workspace-Wissen

- Create a knowledge base.
- Add only workspace-visible documents; verify private documents are not addable.
- Change item retrieval mode between `focused`, `full_context`, and `off`.
- Add a knowledge base to chat context and verify it appears as a chip.

## Chat

- Attach and remove document context.
- Attach and remove knowledge-base context.
- Send a streaming message and verify source chips render.
- Copy a message.
- Edit the latest relevant user message and verify following assistant answer is regenerated.
- Regenerate the latest assistant answer.
- Click follow-up chips and verify they submit as new chat prompts.

## Aufgaben

- Extract tasks from a completed transcript.
- Verify proposed tasks show title, evidence, confidence/priority metadata where available.
- Accept a proposed task and verify it becomes `open`.
- Mark an open task as `done`.
- Dismiss a proposed/open task.
- Open `/tasks`, filter by status, and jump back to the source transcript/segment.

## Regression

- `npm test`
- `npm run lint`
- `npm run build`
- With local Postgres: `DATABASE_URL="postgresql://transkription:transkription@localhost:5432/transkription" node --no-warnings --test tests/retrieval-access-db.test.mjs`
