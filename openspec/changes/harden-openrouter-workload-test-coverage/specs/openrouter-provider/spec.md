# Capability: OpenRouter AI Provider

## ADDED Requirements

### Requirement: Workload Contract Test Coverage

GhostTyper SHALL maintain automated contract tests that verify chat, OCR,
batch-STT, live-STT and TTS requests sent to OpenRouter match the documented
request shape, including capability-aware parameter selection, ZDR/
data-collection enforcement, `verbose_json` gating and best-effort
context-bias forwarding.

#### Scenario: Contract test suite runs

- **WHEN** the test suite runs
- **THEN** each of chat, OCR, batch-STT, live-STT and TTS has a passing test
  asserting its OpenRouter request body and normalized response shape
  against a mocked OpenRouter endpoint.

### Requirement: Vexa Bridge Test Coverage

GhostTyper SHALL maintain automated tests for the Vexa transcription bridge
covering multipart-to-JSON conversion, dynamic key/model/base-URL
resolution from the webapp, `verbose_json` gating and best-effort
context-bias forwarding.

#### Scenario: Bridge test suite runs

- **WHEN** the bridge test suite runs
- **THEN** it exercises multipart forwarding, dynamic API-key/model/base-URL
  resolution, `verbose_json` gating and context-bias forwarding without
  relying on a hardcoded key or model.

### Requirement: TTS Pipeline Test Coverage

GhostTyper SHALL maintain automated tests proving TTS audio is resampled to
22.05 kHz/16-bit/mono and concatenated correctly regardless of the upstream
sample rate.

#### Scenario: Resampling test suite runs

- **WHEN** the TTS test suite runs
- **THEN** it feeds multiple input sample rates through the pipeline and
  asserts the canonical output format and correct WAV concatenation.

### Requirement: Provider Secret Non-Disclosure Test Coverage

GhostTyper SHALL maintain an automated test proving no raw OpenRouter API
key or unredacted upstream error body ever appears in a client-facing API
response.

#### Scenario: Security test suite runs

- **WHEN** the security test suite runs
- **THEN** it asserts every admin-facing config response redacts the API
  key and every provider error response contains only the sanitized detail,
  never the raw upstream body.

### Requirement: Migration Idempotency Test Coverage

GhostTyper SHALL maintain an automated test proving database initialization
can run twice in succession without error or schema drift.

#### Scenario: Idempotency test runs

- **WHEN** the database test suite runs
- **THEN** `initDatabase()` is invoked twice in the same process and both
  invocations succeed.
