# Change: Add EdenAI Provider Foundation

## Why

A review of EdenAI (a multi-vendor AI aggregator: Amazon Transcribe/Deepgram/
AssemblyAI/Speechmatics for STT with native diarization and vocabulary,
DeepL for translation with native glossary support, Custom Document
Parsing/Table Extraction for OCR, Claude/Gemini/DeepSeek/Mistral for chat,
Amazon Polly/Google/Azure/ElevenLabs for TTS) found several concrete
quality gaps in GhostTyper's current OpenRouter-only setup — most notably
the placeholder-masking/verify/retry workaround in
`lib/translation-glossary.js`, which exists specifically to compensate for
LLM-based translation not reliably preserving protected terms, a problem a
native MT glossary avoids by construction.

The product decision is a full, phased migration from OpenRouter to EdenAI
across every AI capability, executed as a sequence of OpenSpec changes
(risk-ordered: translation, then batch transcription, then OCR, then
live-meeting transcription, then chat/analysis/TTS with OpenRouter
decommissioned last). This change is the first step: it adds the EdenAI
provider integration, its own per-capability model registry, and
per-capability routing — without moving any workload's traffic yet. No
existing behavior changes as a result of this change landing.

## What Changes

- Add an `edenai` provider option to the existing generic
  `organization_integrations` table (no schema change — `provider` is
  already a free-text column) alongside `openrouter`, `vexa` and
  `nextcloud`.
- Add an EdenAI client module (`lib/edenai.js`) mirroring
  `lib/openrouter.js`'s shape: capability list, config normalization,
  request builder, and a live-fetched catalogue (`getEdenAiCatalogue`,
  backed by EdenAI's own `GET /v3/models`/`GET /v3/info` endpoints) —
  EdenAI does expose live model/provider discovery, contrary to this
  proposal's original assumption (corrected 2026-08-27 during
  implementation of the first task; see `status.md`). What EdenAI does
  not expose is a live per-unit *pricing-rate* catalogue, which is why
  the manual pricing gate below still applies.
- Add `resolveEdenAiConfig()` (mirrors `resolveOpenRouterConfig()`) and a
  new `resolveActiveProviderConfig({capability})` router that every future
  per-capability migration will call: it prefers EdenAI for a capability
  only once a workspace has enabled EdenAI *and* configured that
  capability's default model, and otherwise resolves OpenRouter — with no
  automatic cross-provider fallback on failure.
- Add an EdenAI admin panel and API routes (GET/PUT, connectivity test,
  per-capability activation) alongside the existing OpenRouter panel, both
  gated on the existing `meeting.admin` permission.
- Add a manual-pricing pre-flight check to EdenAI capability activation:
  activation is rejected, naming the missing `(model, operation)` pairs,
  until every price that capability would bill already exists as an admin
  override in the existing `/admin/prices` UI.
- No workload call site (chat, OCR, transcription, translation, TTS) is
  touched by this change — every capability keeps routing to OpenRouter
  until its own dedicated migration change lands.

## Capabilities

### New Capabilities

- `edenai-provider`: the EdenAI integration itself — per-capability
  provider routing, the static curated model registry, and the manual
  pricing gate that later migration changes build on.

### Modified Capabilities

- `model-governance`: the "Dynamic Catalogue" requirement is reworded to
  name "a provider's authenticated live catalogue" generically instead of
  naming OpenRouter specifically, since EdenAI's `GET /v3/models`/
  `GET /v3/info` endpoints make it a second live-catalogue provider under
  the same requirement, not an exception to it.
- `budget-runtime`: the "Dynamic Provider Pricing" requirement is reworded
  to be provider-general instead of OpenRouter-specific, and gains a
  scenario naming EdenAI's manual pricing requirement explicitly.

## Impact

- New: `lib/edenai.js`, `lib/edenai-service.js` (empty scaffold, grows in
  later phases), `lib/edenai-probes.js`
- Changed: `lib/settings-service.js` (add `resolveEdenAiConfig`)
- New: `lib/ai-provider-router.js` (`resolveActiveProviderConfig`)
- New: `components/settings/EdenAiIntegrationPanel.js`
- Changed: `pages/settings/organization/integrations.js` (render the new
  panel alongside the existing OpenRouter/Vexa panels)
- New: `pages/api/organizations/integrations/edenai.js`,
  `.../edenai/test.js`, `.../edenai/activate.js`
- Changed: `pages/api/models.js` (add a `provider` query parameter)
- No changes to any existing workload call site, no deletions, no data
  migration.
