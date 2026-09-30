# Capability: EdenAI Provider

## REMOVED Requirements

### Requirement: EdenAI Grammar/Spell-Check Adapter

GhostTyper SHALL route the `spelling_grammar` text-optimization preset to
EdenAI's dedicated spell-check feature when a workspace has activated the
`grammar` capability, applying returned corrections deterministically to
the original text rather than requesting a free rewrite, and SHALL leave
every other text-optimization preset unaffected.

#### Scenario: Spelling/grammar preset uses the dedicated feature

- **GIVEN** a workspace has activated EdenAI for the `grammar` capability
- **WHEN** a text-optimization request is submitted with preset
  `spelling_grammar`
- **THEN** it is routed to EdenAI's `text/spell_check` feature, and the
  returned corrections are spliced into the original text to produce the
  response's `optimizedText`, rather than requesting a free-form LLM
  rewrite

#### Scenario: Other presets are unaffected

- **GIVEN** a workspace has activated EdenAI for the `grammar` capability
  but not for `chat`
- **WHEN** a text-optimization request is submitted with preset
  `clearer` (or any preset other than `spelling_grammar`)
- **THEN** it is routed to whichever provider is active for the `chat`
  capability, exactly as before this change

#### Scenario: Grammar capability not yet activated

- **GIVEN** a workspace has not activated EdenAI for the `grammar`
  capability
- **WHEN** a text-optimization request is submitted with preset
  `spelling_grammar`
- **THEN** it continues to route through the existing LLM-prompt-based
  path on whichever provider is active for the `chat` capability

#### Scenario: Overlapping correction spans do not corrupt output

- **GIVEN** EdenAI returns two corrections with overlapping
  `offset`/`length` spans
- **WHEN** corrections are spliced into the original text
- **THEN** the overlapping span is left uncorrected and logged rather
  than applied, so the output text is never corrupted

## MODIFIED Requirements

### Requirement: Hardcoded Per-Capability Model

GhostTyper SHALL use exactly one hardcoded, source-controlled model per
EdenAI capability, chosen through a real comparative evaluation against
production EdenAI before being hardcoded, rather than an admin-selected
model from a live catalogue. A capability with no model yet chosen
SHALL NOT be activatable.

#### Scenario: Admin opens EdenAI settings

- **WHEN** a workspace admin opens the EdenAI integration screen
- **THEN** each capability card shows its hardcoded model name (or "not
  yet configured" for a capability with no model chosen), with no
  catalogue browsing, allowlist, or model dropdown

#### Scenario: Activating a capability with no model chosen yet

- **GIVEN** a capability's hardcoded model is unset
- **WHEN** an admin attempts to activate that capability
- **THEN** activation is rejected with `MODEL_NOT_YET_CONFIGURED`,
  naming the capability

#### Scenario: Activating a capability with a hardcoded model

- **GIVEN** a capability's hardcoded model is set and its pricing row
  exists
- **WHEN** an admin activates that capability
- **THEN** the existing live probe and pricing gate run against the
  hardcoded model exactly as they did against an admin-chosen model
  before this change, and activation succeeds or fails on the same
  grounds as before
