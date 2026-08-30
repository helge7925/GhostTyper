# Status: Consolidate AI Providers On OpenRouter

Last updated: 2026-08-23

## Current State

- **Implemented; awaiting organization activation and operational soak.**
- Application runtime, administration, provider adapters, USD accounting and
  deployment configuration now use OpenRouter as the sole AI provider.

## Verified

- `npm run lint` and the 374/376-test unit/contract suite pass (`npm run lint`,
  `node --no-warnings --test tests/*.test.mjs` re-run 2026-08-23).
- The PostgreSQL 16 DB suite passes 10/10 and initializes the schema twice.
- `npm run build` and the OrbStack production image build pass.
- The OrbStack Webapp, PostgreSQL and OpenRouter Vexa bridge are healthy;
  `/api/health`, `/login` and unauthenticated model-API denial were smoked.
- Production source contains no fixed model IDs or direct Cortecs/Mistral
  inference hosts.

## Post-implementation fixes (2026-08-23)

An independent code-level audit (six parallel review passes against the
actual source, not just this document) found the implementation
substantively complete but flagged five gaps against the plan, all closed
in this pass:

- Chat calls always stripped `temperature`/`response_format`/`stream`
  regardless of catalogue support (`supportedParameters` was never wired
  from the model catalogue into `aiJsonRequest`) — analysis/translation
  JSON-mode requests were silently sent without `response_format`.
  `lib/ai-service.js` now resolves the selected model's
  `supportedParameters` from the cached catalogue before each chat call.
- Batch STT never requested `verbose_json` even for catalogue-verified
  models (only the live/Vexa path was gated). `lib/transcription-worker.js`
  now checks catalogue support the same way the live path does.
- Context/vocabulary terms (`context_bias`) were resolved end-to-end but
  never actually placed on the OpenRouter request body, in either the
  batch or the Vexa-bridge path, and were not surfaced anywhere.
  OpenRouter only honours STT vocabulary hints via a provider-specific
  passthrough (`provider.options.groq.prompt`) with no catalogue signal
  for which routed provider will apply it, so this is now sent as an
  explicit best-effort hint in both `lib/ai-service.js` and
  `services/voxtral-bridge/main.py`, with a transcription event + audit
  log entry (`transcription.context_bias_forwarded`) so it isn't silently
  dropped.
- `MODEL_UNAVAILABLE` fallback exhaustion in the batch worker had no
  admin-visible signal beyond the job's own error state; it now also
  writes an `org.integration.openrouter.model_unavailable` audit event.
- `README.md`/`README.de.md` Features/Tech-Stack/Architecture/Configuration
  sections still named Mistral as the active AI provider even though the
  Quickstart/env sections were already OpenRouter-only; corrected.

Known remaining gap (not closed in this pass): unit-test coverage for
per-workload contract shapes (OCR/batch-STT/live-STT/TTS), the Vexa bridge
(`services/voxtral-bridge/main.py` has no test suite at all), TTS
resampling/WAV concatenation, and admin allowlist UI is thinner than the
plan implies — flagged for a follow-up task, not blocking activation.

## Outstanding

- A workspace admin must provide a real OpenRouter key, capability allowlists,
  defaults and required voice/manual-price overrides.
- Paid activation probes and the real upload/OCR/chat/TTS/Vexa workload matrix
  require that configuration; Vexa intentionally fails closed before it.
- The seven-day soak and separately approved legacy-column cleanup remain
  operational rollout gates.
