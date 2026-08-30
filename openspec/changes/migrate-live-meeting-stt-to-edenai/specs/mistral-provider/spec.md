# Capability: Mistral Provider

## ADDED Requirements

### Requirement: Direct Mistral Integration For Live-Meeting STT

GhostTyper SHALL route live-meeting speech-to-text exclusively to
Mistral's realtime transcription endpoint, called directly (not through
OpenRouter's or EdenAI's aggregation layers), since both of those were
measured too slow for the live-meeting audio-chunk cadence. GhostTyper
SHALL NOT fall back to another provider for this capability — a missing
Mistral configuration SHALL surface as an explicit error, not a silent
fallback.

#### Scenario: A workspace has configured its own Mistral key

- **GIVEN** an organization has saved a Mistral API key in its
  integration settings
- **WHEN** a live meeting sends an audio chunk to the transcription
  bridge
- **THEN** the bridge transcribes it via that organization's Mistral key

#### Scenario: No Mistral key is configured anywhere

- **GIVEN** neither the organization nor the operator-fallback
  environment variable has a Mistral API key configured
- **WHEN** a live meeting sends an audio chunk to the transcription
  bridge
- **THEN** the bridge returns a clear "no API key" error rather than
  falling back to OpenRouter or EdenAI

#### Scenario: Compressed audio is transcoded before transcription

- **GIVEN** Vexa-Lite sends a compressed audio chunk (webm/opus)
- **WHEN** the bridge processes it
- **THEN** it is decoded to raw PCM before being sent to Mistral's
  realtime endpoint, which accepts PCM only

#### Scenario: Saving an API key is blocked until pricing is configured

- **GIVEN** no price row exists for
  `(mistral, voxtral-mini-transcribe-realtime-2602, meeting_transcription)`
- **WHEN** an admin attempts to save a Mistral API key in the
  organization's integration settings
- **THEN** the save is rejected with `PRICE_OVERRIDE_REQUIRED` and the
  key is not persisted — since a saved key is otherwise immediately
  active for real meetings, this is the only pricing pre-flight point
  Mistral has, unlike EdenAI's separate per-capability activation step

#### Scenario: The credential layer is reusable beyond STT

- **GIVEN** the direct Mistral integration is configured for live-meeting
  STT
- **WHEN** a future feature also needs to call Mistral directly (e.g.
  live-meeting translation)
- **THEN** it reuses the same stored credential and resolution function
  without a schema change — the configuration layer carries only a
  generic API key, no STT-specific fields
