# Capability: EdenAI Provider

## MODIFIED Requirements

### Requirement: Hardcoded Per-Capability Model

GhostTyper SHALL NOT offer `liveTranscription` as an EdenAI capability.
`EDENAI_HARDCODED_MODEL.liveTranscription` stays `null` permanently, by
design — not "not yet decided" the way it reads for a capability whose
comparison test simply hasn't run yet. Live-meeting STT is excluded from
EdenAI (and from OpenRouter) on measured latency grounds; see the
`mistral-provider` capability for what actually handles it.

#### Scenario: liveTranscription cannot be activated on EdenAI

- **GIVEN** an admin views the EdenAI integration panel
- **WHEN** they look for a live-transcription capability card
- **THEN** none exists — `liveTranscription` is not among EdenAI's
  capabilities at all

#### Scenario: Live in-meeting translation is unaffected by this exclusion

- **GIVEN** a workspace has activated EdenAI's `chat` capability
- **WHEN** a live in-meeting translation delta is computed during a
  meeting
- **THEN** it targets EdenAI through `chat` (the same adapter batch
  translation and inline translation already use), independent of the
  liveTranscription exclusion above — translation and transcription are
  unrelated capabilities that happen to share a meeting
