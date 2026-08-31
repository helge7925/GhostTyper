# Capability: EdenAI Provider

## ADDED Requirements

### Requirement: EdenAI Batch Transcription Adapter

GhostTyper SHALL route upload (batch) transcription to EdenAI when a
workspace has configured `transcription` as its active capability,
wrapping EdenAI's asynchronous job submission and polling behind the same
per-chunk synchronous contract batch transcription already uses, and
SHALL leave manual speaker assignment and best-effort context-bias
forwarding unchanged.

#### Scenario: Async job is wrapped synchronously for the caller

- **GIVEN** EdenAI is the active transcription provider for a workspace
- **WHEN** a chunk of an uploaded audio file is transcribed
- **THEN** GhostTyper submits an EdenAI asynchronous job and polls it to
  completion before returning that chunk's result, so the existing
  chunk-loop and budget-reservation code sees the same result shape it
  does for OpenRouter

#### Scenario: Transcription and analysis can use different providers

- **GIVEN** a workspace has activated EdenAI for `transcription` but not
  for `chat`
- **WHEN** a batch job with auto-analysis enabled completes transcription
- **THEN** the transcription call targets EdenAI and the subsequent
  analysis call targets OpenRouter, without error

#### Scenario: Diarization and vocabulary stay manual

- **GIVEN** EdenAI is the active transcription provider and the
  underlying vendor offers native diarization
- **WHEN** a diarized transcription is requested
- **THEN** GhostTyper still performs manual speaker assignment in the UI
  as before, and does not yet consume the vendor's native diarization
  output
