# Change: Consolidate AI Providers On OpenRouter

## Why

GhostTyper currently maintains separate Cortecs and Mistral credentials,
model lists, request adapters and pricing assumptions. OpenRouter now exposes
the chat, transcription, speech and multimodal APIs required by the product.
A single application-facing provider reduces configuration and makes the live
model catalogue available without shipping model IDs in application code.

## Decisions Captured

- GhostTyper SHALL send every active AI workload through OpenRouter.
- Vexa and Nextcloud remain separate non-inference integrations.
- Models SHALL come from the authenticated OpenRouter catalogue; production
  code SHALL NOT contain model IDs or curated model lists.
- Workspace admins SHALL manage an allowlist and default for chat, OCR,
  transcription, live transcription and TTS.
- Every request SHALL enforce zero data retention and deny data collection.
- A missing user model SHALL fall back once to the workspace default; a
  missing default SHALL fail closed.
- Pricing, budgets and usage SHALL use USD. Existing numeric monetary values
  are relabelled from EUR to USD without foreign-exchange conversion.
- Cutover SHALL be staged, but an activated workspace SHALL never fall back to
  Cortecs or Mistral.

## What Changes

- Add one encrypted OpenRouter integration and one server-side OpenRouter
  client.
- Add an authenticated, capability-filtered model catalogue with admin
  allowlists and workspace defaults.
- Move chat, OCR, batch/live STT and TTS to OpenRouter endpoints.
- Replace fixed price seeds and committed cost estimates with dynamic model
  prices and OpenRouter-reported cost.
- Change the canonical product currency from EUR to USD.
- Retire Cortecs/Mistral routes, settings, secrets and direct network calls
  after workspace activation.

## Out Of Scope

- Replacing Vexa as the meeting bot.
- EU-only OpenRouter enterprise routing.
- Preventing OpenRouter from choosing Mistral as an upstream OCR provider.
- Automatic cross-model selection outside the workspace allowlist.
- Destructive removal of legacy database columns in this change.

## Success Criteria

- No active inference request targets Cortecs or Mistral directly.
- No production model ID is hard-coded.
- Admins can select all compatible ZDR models returned for their key.
- All five AI capabilities pass contract and end-to-end smoke tests.
- New usage and budget data is consistently accounted in USD.

