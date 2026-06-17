# GhostTyper OpenSpec Context

## Product

GhostTyper is a self-hosted workspace product for transcription, OCR, translation, AI analysis, tabular extraction, meeting capture, and chat-based document work.

## Architecture

- Next.js Pages Router frontend and API routes.
- PostgreSQL primary datastore.
- Existing `transcriptions` table currently stores audio transcriptions, remote meetings, OCR outputs, translations, and data-table analyses.
- Organizations and role-based permissions are already present.
- Cortecs provides OpenAI-compatible chat/transcription endpoints.
- Mistral OCR remains used for OCR.

## Planning Rules

- Product changes should be specified through OpenSpec changes before implementation.
- Use additive migrations first; avoid destructive schema changes until data is backfilled and verified.
- Preserve existing `transcriptions` detail routes while introducing broader `Dateien` concepts.
- Prefer small, verifiable phases over one large rewrite.
