# Capability: EdenAI Provider

## ADDED Requirements

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
