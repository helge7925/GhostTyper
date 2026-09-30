# GhostTyper OpenSpec Context

## Product

GhostTyper is a self-hosted workspace product for transcription, OCR, translation, AI analysis, tabular extraction, meeting capture, and chat-based document work.

## Architecture

- Next.js Pages Router frontend and API routes.
- PostgreSQL primary datastore.
- Existing `transcriptions` table currently stores audio transcriptions, remote meetings, OCR outputs, translations, and data-table analyses.
- Organizations and role-based permissions are already present.
- AI providers are in transition per the `migrate-*-to-edenai` OpenSpec
  changes: EdenAI (hardcoded per-capability models) is being activated
  capability-by-capability on top of OpenRouter, which remains the fallback
  provider for chat/OCR/batch STT/TTS; live-meeting STT runs exclusively on
  Mistral's Voxtral realtime API via the `voxtral-bridge` container. EdenAI
  models are hardcoded in `lib/edenai.js` (not admin-configured); OpenRouter
  models stay org-governed (allowlist + defaults).

## Planning Rules

- Product changes should be specified through OpenSpec changes before implementation.
- Use additive migrations first; avoid destructive schema changes until data is backfilled and verified.
- Preserve existing `transcriptions` detail routes while introducing broader `Dateien` concepts.
- Prefer small, verifiable phases over one large rewrite.
