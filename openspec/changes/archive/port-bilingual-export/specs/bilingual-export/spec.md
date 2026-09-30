# Capability: Bilingual Side-by-Side Export

## ADDED Requirements

### Requirement: Bilingual Export Of Translated Documents

GhostTyper SHALL offer an export that aligns source and target text for a
translated document.

#### Scenario: User exports a translation bilingually

- **WHEN** the user chooses the bilingual export on a translation result
- **THEN** the output presents source and target text aligned side by side.

#### Scenario: Export reachable from the translation UI

- **GIVEN** a completed translation
- **THEN** a bilingual export action is visible in the translation result UI.

### Requirement: Bounded And Escaped Output

GhostTyper SHALL bound and escape bilingual export output.

#### Scenario: Oversized document

- **WHEN** a document exceeds the configured export bound
- **THEN** the export fails with a clear error instead of rendering unbounded output.

#### Scenario: Markup in source text

- **GIVEN** source or target text contains HTML-significant characters
- **THEN** the exported output escapes them rather than emitting raw markup.

### Requirement: Permission-Checked Export

GhostTyper SHALL restrict bilingual export to users permitted to read the
underlying document.

#### Scenario: User without access

- **WHEN** a user without read permission requests a bilingual export
- **THEN** the request is rejected.
