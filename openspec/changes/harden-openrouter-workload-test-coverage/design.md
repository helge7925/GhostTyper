# Design: Harden OpenRouter Workload Test Coverage

## Test Runner Choice

The project deliberately runs everything through Node's built-in
`node --test` (see `package.json`'s `test`/`test:db` scripts) rather than
Jest or another framework. New JS tests keep that convention: mock
`global.fetch` per test the same way `tests/openrouter.test.mjs` already
does, no new JS test dependency.

The Vexa bridge is a separate Python (FastAPI) service with no existing test
tooling. Rather than force it through the Node runner (which cannot import
Python), add a small `pytest` suite scoped to
`services/voxtral-bridge/tests/`. Tests import `main.py`'s request-building
and config-merging functions directly and call them in-process — no live
HTTP server, no network — so they stay fast and hermetic, mirroring how the
JS contract tests mock fetch instead of hitting a live endpoint.

## Contract Tests

Each workload gets one file that mocks `global.fetch`, calls the relevant
`lib/ai-service.js` export, and asserts:

- **Chat** (`analyzeTranscription`/`translateText`/`translateTextSegments`/
  `optimizeText`/`generateTemplate`): `temperature`/`response_format`/
  `stream` appear in the outbound body only when a mocked catalogue entry
  lists them in `supported_parameters`; `provider.zdr`/`data_collection`
  are always present.
- **OCR** (`performOCR`): PDF requests include the `file-parser`/`mistral-ocr`
  plugin block; image requests send a base64 `image_url`; the response is
  normalized to `{markdown, usage, model, providerRequestId}`.
- **Batch STT** (`transcribeAudio`/`requestTranscriptionFile`):
  `response_format: verbose_json` is sent only when the mocked catalogue
  model supports it; segments carry `precise_timestamps` correctly in both
  cases; a non-empty `contextBias` produces
  `provider.options.groq.prompt` and a `contextBiasForwarded: true` result.
- **Live STT**: covered via the Vexa bridge suite (below) plus an existing
  `lib/integrations.js` gating test extended for `liveTranscriptionVerified`.
- **TTS** (`lib/tts.js`): request targets `/audio/speech`; a mocked
  `x-generation-id` header is captured for later cost lookup.

## Vexa Bridge Tests (pytest)

- Multipart form → `input_audio` base64 conversion (including the
  `weba`→`webm` extension rewrite).
- `fetch_effective_config` resolves key/model/base-URL from the webapp
  callback response, not from `MODEL_OVERRIDE`/`OPENROUTER_API_KEY`, when the
  callback succeeds; falls back to the operator env var only when the
  callback fails or the workspace has no key.
- `verbose_json` is set on the outbound payload only when
  `config["verbose_json"]` is true and the caller did not already set
  `response_format`.
- Non-empty `context_bias` produces `provider.options.groq.prompt`
  truncated to 800 characters; empty `context_bias` omits `provider.options`
  entirely.

## TTS Pipeline Tests

Feed synthetic MP3 buffers at a few distinct upstream sample rates through
`lib/tts.js`'s `mp3ToCanonicalPcm` + WAV-concatenation path (using the same
`ffmpeg`/`@ffmpeg-installer/ffmpeg` already vendored for the audio-conversion
tests) and assert: output PCM decodes to 22 050 Hz / 16-bit / mono
regardless of input rate, and concatenating two chunks produces a WAV header
whose declared data length matches the actual byte count.

## Migration Idempotency Test

`tests/db/db-init-idempotency.test.mjs` (participates in the existing
`test:db` PostgreSQL suite): call `initDatabase()`, then call it again in
the same process, and assert both resolve without throwing and that a
representative widened column (e.g. `transcriptions.model`) still reports
`VARCHAR(255)` afterward.

## Secret Non-Disclosure Test

- Call the `GET`/`PUT` OpenRouter integration handlers with a mocked
  authenticated admin request and assert the JSON response never contains
  the configured raw API key string, only `apiKeyConfigured: true`.
- Mock an OpenRouter 4xx/5xx response containing a body with a fake
  secret-looking string, drive it through `openRouterJsonRequest`, and
  assert the error surfaced to a route handler's JSON response never
  includes that raw body — only the already-truncated/sanitized `details`.

## CI

Add a `pytest services/voxtral-bridge/tests` step to the existing CI
workflow alongside `npm test`, gated on Python already being set up for the
bridge's own lint/build step if one exists, otherwise added fresh.
