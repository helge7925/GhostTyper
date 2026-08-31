# Change: Migrate Chat, Analysis And TTS To EdenAI, Decommission OpenRouter

## Why

This is the final change in the OpenRouter→EdenAI migration sequence,
deliberately last because it is the highest blast-radius step: chat/
analysis underlies every template and table-extraction feature in the
app, `analyzeTranscription`'s `response_format:{type:'json_object'}`
contract is load-bearing throughout, and OpenRouter's per-model
`supported_parameters` catalogue signal — which today tells GhostTyper
when it's safe to send `temperature`/`response_format`/`stream` — has no
confirmed EdenAI equivalent. By this point in the sequence, Translation,
Batch-STT, OCR and Live-Meeting-STT have already proven the router/
adapter/pricing-gate pattern; this change applies it to the remaining
capabilities and then retires OpenRouter entirely.

## What Changes

- `lib/edenai-service.js` gains `analyzeTranscriptionEdenAi`,
  `optimizeTextEdenAi`, `generateTemplateEdenAi`.
- Six structurally identical call sites switch from
  `resolveOpenRouterConfig`/hardcoded `provider:'openrouter'` to
  `resolveActiveProviderConfig({capability:'chat'})`: the analysis blocks
  in `pages/api/ocr.js` and `lib/transcription-worker.js`,
  `pages/api/templates/generate.js`, `pages/api/knowledge-prep/text.js`,
  `pages/api/text-optimization.js`, `lib/manual-analysis.js`.
- Three TTS call sites (`pages/api/transcriptions/[id]/audio.js`,
  `pages/api/share/[token]/audio.js`, `lib/in-meeting-audio.js`'s
  `speakOne()`) switch to the same router for `capability:'tts'`.
- **Pre-cutover validation**: before any chat model is allowlisted for a
  workspace, `probeEdenAiCapability({capability:'chat', model})` must
  confirm — per model, not just the workspace default — that it reliably
  returns valid JSON matching a fixed test schema and preserves array
  length on a strict-JSON-array request, since no live catalogue signal
  exists to infer this the way OpenRouter's does.
- **Full OpenRouter decommission**, mirroring exactly how Cortecs/Mistral
  were removed in `consolidate-ai-providers-openrouter`: one transaction
  disables and clears the OpenRouter integration for a fully-migrated
  workspace; `lib/openrouter.js`, `lib/openrouter-pricing.js`,
  `lib/openrouter-pricing-core.js`, `lib/openrouter-probes.js`,
  `components/settings/OpenRouterIntegrationPanel.js` and the OpenRouter
  API routes are deleted; the OpenRouter branch is removed from
  `services/voxtral-bridge/main.py`; `OPENROUTER_*` env vars are removed
  from `.env.example`; `openspec/project.md`, both READMEs, and the seven
  docs files touched by the original Cortecs/Mistral removal are updated
  to describe EdenAI as the sole provider.
- `lib/model-assistant.js`'s `openRouterSortForGoal`/`GOAL_SORT`
  ("recommend a model by price/speed/quality") is removed with no
  replacement — a genuine, named UX regression, since EdenAI's static
  registry has no live sort signal to draw on.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `edenai-provider`: adds the EdenAI Chat Adapter (with the per-model
  structured-output probe requirement) and EdenAI TTS Adapter
  requirements, plus the terminal Single Application-Facing AI Provider,
  Complete Workload Coverage, and No Legacy Runtime Fallback requirements
  that now describe EdenAI instead of OpenRouter.
- `openrouter-provider`: all requirements are removed — the capability is
  retired along with the code implementing it.

## Impact

- Changed: `pages/api/ocr.js`, `lib/transcription-worker.js`,
  `pages/api/templates/generate.js`, `pages/api/knowledge-prep/text.js`,
  `pages/api/text-optimization.js`, `lib/manual-analysis.js`,
  `pages/api/transcriptions/[id]/audio.js`,
  `pages/api/share/[token]/audio.js`, `lib/in-meeting-audio.js`
- Deleted: `lib/openrouter.js`, `lib/openrouter-pricing.js`,
  `lib/openrouter-pricing-core.js`, `lib/openrouter-probes.js`,
  `components/settings/OpenRouterIntegrationPanel.js`,
  `pages/api/organizations/integrations/openrouter.js` (+`test.js`/
  `activate.js`), the OpenRouter branch of
  `services/voxtral-bridge/main.py`, `openRouterSortForGoal`/`GOAL_SORT`
  in `lib/model-assistant.js`
- Changed: `.env.example`, `openspec/project.md`, `README.md`,
  `README.de.md`, `docs/ai-integration.md`, `docs/architecture.md`,
  `docs/gdpr-setup.md`, `docs/vexa-integration.md`,
  `docs/api-specification.md`, `docs/docker-setup.md`,
  `docs/vps-deployment-guide.md`
