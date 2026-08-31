# Tasks: Harden OpenRouter Workload Test Coverage

## 1. Workload Contract Tests

- [ ] 1.1 Chat contract test: capability-aware `temperature`/`response_format`/
  `stream` stripping, ZDR/data_collection always present.
- [ ] 1.2 OCR contract test: PDF `file-parser`/`mistral-ocr` plugin, image
  base64 input, `{markdown, usage, model, providerRequestId}` normalization.
- [ ] 1.3 Batch-STT contract test: `verbose_json` gated by catalogue support,
  `precise_timestamps` flag correctness, context-bias best-effort forwarding.
- [ ] 1.4 Live-STT gating test: `liveTranscriptionVerified` required before
  `verbose_json` is requested through the bridge config resolver.
- [ ] 1.5 TTS contract test: `/audio/speech` target, generation-id capture.

## 2. Vexa Bridge Tests

- [ ] 2.1 Add `pytest` + `services/voxtral-bridge/tests/` harness and dev
  dependency.
- [ ] 2.2 Multipart-to-`input_audio` conversion test (incl. `weba`→`webm`).
- [ ] 2.3 Dynamic key/model/base-URL resolution vs. operator-fallback test.
- [ ] 2.4 `verbose_json` gating test.
- [ ] 2.5 Context-bias best-effort `provider.options.groq.prompt` forwarding
  test, including the 800-character truncation and the empty-bias no-op case.

## 3. TTS Pipeline Tests

- [ ] 3.1 Resampling test: multiple input sample rates → canonical
  22.05 kHz/16-bit/mono output.
- [ ] 3.2 WAV concatenation test: correct header/data-length across chunk
  boundaries.

## 4. Migration And Security

- [ ] 4.1 `initDatabase()` run-twice idempotency test.
- [ ] 4.2 Security test: API key never appears in admin config responses;
  raw upstream error bodies never appear in client-facing error responses.

## 5. Verification

- [ ] 5.1 `npm run lint` and the full Node test suite pass.
- [ ] 5.2 `pytest services/voxtral-bridge/tests` passes.
- [ ] 5.3 `openspec validate harden-openrouter-workload-test-coverage --strict`
  passes.
