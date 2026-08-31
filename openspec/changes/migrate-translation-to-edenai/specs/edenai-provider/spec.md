# Capability: EdenAI Provider

## MODIFIED Requirements

### Requirement: Hardcoded Per-Capability Model

GhostTyper SHALL route translation-shaped operations (`translation`,
`office_translation`, `live_translation`) through the `chat` capability's
hardcoded model when a workspace has activated `chat`, and SHALL NOT
expose a separate `translation` capability, activation step, or hardcoded
model. GhostTyper SHALL preserve the existing do-not-translate/glossary
masking guard and fail-safe-to-source behavior unchanged regardless of
which provider performs the call.

#### Scenario: Protected-term masking is preserved

- **GIVEN** EdenAI's `chat` capability is active for a workspace
- **WHEN** text containing glossary or do-not-translate terms is
  translated
- **THEN** the existing placeholder-masking and post-call verification
  guard runs unchanged, and a translation missing a placeholder still
  falls back to the original source text

#### Scenario: Office and PDF document translation reuse the same adapter

- **GIVEN** EdenAI's `chat` capability is active for a workspace
- **WHEN** an office document or a PDF is translated
- **THEN** the local extraction/reassembly pipeline is unchanged and only
  its segment-translation call targets EdenAI's chat adapter

#### Scenario: No dedicated translation capability exists

- **GIVEN** a workspace has activated EdenAI's `chat` capability but not
  any other capability
- **WHEN** an admin views the EdenAI integration panel
- **THEN** no separate "translation" capability card is shown, and
  translation requests already route to EdenAI through `chat`

#### Scenario: Live in-meeting translation is not yet included

- **GIVEN** EdenAI's `chat` capability is active for a workspace
- **WHEN** a live in-meeting translation (`live_translation` operation) is
  requested during a meeting
- **THEN** it continues to route to OpenRouter until the live-meeting
  transcription migration activates EdenAI for that path
