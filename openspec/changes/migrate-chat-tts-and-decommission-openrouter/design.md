# Design: Migrate Chat, Analysis And TTS To EdenAI, Decommission OpenRouter

## Pre-Cutover Validation

`analyzeTranscription()`'s `response_format:{type:'json_object'}`
contract is load-bearing for the entire template/table-extraction feature
set; `translateTextSegments()`'s strict-JSON-array contract is already
exercised by the Translation change. OpenRouter's `supported_parameters`
catalogue field (consumed by `resolveSupportedParameters()`/
`aiJsonRequest()`) is what lets GhostTyper know per-model whether
`temperature`/`response_format`/`stream` are safe to send; EdenAI has no
confirmed equivalent signal. `probeEdenAiCapability({capability:'chat',
model})` in `lib/edenai-probes.js` stands in for that missing signal, and
— unlike `probeOpenRouterDefaults`'s non-empty-content check — must:

1. Send a structured-output request and assert the response parses as
   valid JSON matching a fixed test schema.
2. Send a strict-array-JSON request matching `translateTextSegments`'s
   exact contract and assert length preservation.
3. Run **per allowlisted model**, not only the workspace default —
   `resolveConfiguredModel` lets a user pick any allowlisted model, and
   JSON-mode reliability is expected to vary across EdenAI's underlying
   vendors (Claude, Gemini, DeepSeek, Mistral); a default that passes does
   not imply every other allowlisted model does too.

This is stricter than OpenRouter ever needed to be, precisely because the
missing catalogue signal has to be replaced by an activation-time probe
instead of a continuously-refreshed live signal — there is no equivalent
of a model silently changing behavior being caught by a later catalogue
refresh.

## Call Sites

Six analysis/chat call sites are structurally identical: resolve
`resolveActiveProviderConfig({capability:'chat'})` in place of
`resolveOpenRouterConfig`, branch to the OpenRouter or EdenAI function.
Three TTS call sites are lower-risk than any other part of this
migration, since `lib/tts.js`'s ffmpeg-based PCM normalization to 22.05
kHz/16-bit/mono already runs uniformly regardless of upstream provider —
only the upstream fetch changes.

## Full Decommission

Mirrors `git show d2aaf5c` (the commit that removed Cortecs/Mistral)
file-for-file: delete the OpenRouter client/pricing/probes modules and
admin panel/routes, remove the OpenRouter branch from the Vexa bridge,
strip `OPENROUTER_*` env vars, and update every doc file that commit also
touched. Decommission for a given workspace happens transactionally: only
once every capability's `defaultModels` entry is confirmed set on EdenAI
does `disableAndClearIntegration(orgId, 'openrouter', {client})` run —
matching the shipped precedent's "activate is a transaction" pattern, just
inverted (disabling the old provider instead of the new one).

`lib/model-assistant.js`'s `openRouterSortForGoal`/`GOAL_SORT` (the
"recommend a model by price/speed/quality" assistant, which depends on
OpenRouter's live catalogue `sort` query parameter) is deleted with no
replacement. This is a real, user-visible feature loss with no EdenAI
equivalent — EdenAI's live catalogue (`GET /v3/models`/`GET /v3/info`,
confirmed in `add-edenai-provider-foundation`) carries no comparable
price/latency/intelligence ranking query parameter to sort by. Called out
explicitly rather than silently dropped.

## Risks / Trade-offs

- This is the highest-consequence unknown in the entire migration: an
  EdenAI chat model that passes the structured-output probe at activation
  time but degrades in JSON reliability under real production load (long
  transcripts, unusual template prompts, edge-case languages) has no
  catalogue-refresh safety net the way an OpenRouter model does.
  Prototype the probe against real EdenAI chat models **early** in
  implementation, not deferred to the end of this already-last phase.
- Narrower model catalogue: OpenRouter exposes 300+ models across every
  major provider; EdenAI's curated registry (Foundation change) is
  expected to be materially smaller. Workspaces with a specific model
  preference not in the registry lose that option — a real UX
  narrowing, accepted as the cost of the "full migration" decision.
- The decommission step is irreversible in practice once OpenRouter's
  code is deleted (re-adding it would mean re-implementing
  `lib/openrouter.js` and friends from source control history) — treat
  the seven-file-doc-update and code-deletion tasks as the very last
  tasks in this change, only after every prior phase's workload has run
  successfully in production for a soak period, matching the "seven
  error-free days" rollout discipline `consolidate-ai-providers-openrouter`
  itself used for its own cutover.
