# Change: Harden OpenRouter Workload Test Coverage

## Why

`consolidate-ai-providers-openrouter` shipped the OpenRouter adapters (chat,
OCR, batch STT, live/Vexa STT, TTS) and passes lint/build/the existing
374-test suite, but an independent code-level audit (2026-08-23, six
parallel review passes against the actual source) found no dedicated
contract tests for any individual workload, no tests at all for the Vexa
bridge (`services/voxtral-bridge/main.py`), no TTS resampling/WAV
concatenation tests, no explicit "run the DB migration twice" idempotency
test, and no test proving the OpenRouter API key or a raw upstream error
body never reaches a client response. `tests/openrouter.test.mjs` covers
catalogue/governance basics well, but a regression in request shaping, key
redaction, or the Python bridge would currently ship silently.

## What Changes

- Add mock-contract tests for chat, OCR, batch-STT, live-STT and TTS request
  bodies and normalized response shapes against OpenRouter endpoints,
  including the capability-aware parameter stripping and best-effort
  context-bias forwarding added post-launch.
- Add a `pytest` suite for the Vexa bridge (`services/voxtral-bridge/`)
  covering multipart-to-`input_audio` conversion, dynamic key/model/base-URL
  resolution from the webapp callback, `verbose_json` gating, and
  context-bias best-effort forwarding.
- Add TTS pipeline tests proving ffmpeg resampling to 22.05 kHz/16-bit/mono
  and correct WAV concatenation across varying input sample rates.
- Add an explicit test that runs `initDatabase()` twice in one process and
  asserts both succeed without schema drift.
- Add a security test proving no admin-facing config response ever includes
  a raw OpenRouter API key, and no client-facing error response ever
  includes an unredacted upstream error body.

No production behavior changes; this is test-coverage-only work against the
already-shipped adapters.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `openrouter-provider`: add verification requirements (contract tests,
  bridge tests, TTS pipeline tests, migration-idempotency test, secret
  non-disclosure test) that the shipped adapters must keep satisfying.

## Impact

- `tests/openrouter-chat.test.mjs`, `tests/openrouter-ocr.test.mjs`,
  `tests/openrouter-stt.test.mjs`, `tests/openrouter-tts.test.mjs` (new)
- `services/voxtral-bridge/tests/` (new `pytest` suite) and
  `services/voxtral-bridge/requirements-dev.txt` (new dev dependency)
- `tests/tts-resampling.test.mjs` (new)
- `tests/db/db-init-idempotency.test.mjs` (new)
- `tests/openrouter-secret-disclosure.test.mjs` (new)
- CI: a Python test step for the bridge suite alongside the existing Node
  test step.
