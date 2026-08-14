# Capability: Dateien Library

## ADDED Requirements

### Requirement: Unified Dateien Library

GhostTyper SHALL expose a user-facing `Dateien` library that lists all document-like artifacts across transcription, meeting, OCR, translation, data-table, text, and workspace-file sources.

#### Scenario: User views Dateien

- **WHEN** an authenticated user opens the library
- **THEN** the UI shows the label `Dateien`
- **AND** the list includes all readable documents for the active workspace
- **AND** each entry shows its source type, title, status, visibility, owner, and updated date.

### Requirement: Private And Workspace Visibility

Documents SHALL support `private` and `workspace` visibility.

#### Scenario: Private file access

- **GIVEN** a document has `visibility = private`
- **WHEN** another workspace member opens `Dateien`
- **THEN** that document is not listed
- **AND** direct API access returns 404 or 403.

#### Scenario: Workspace file access

- **GIVEN** a document has `visibility = workspace`
- **WHEN** a workspace member with `document.read` opens `Dateien`
- **THEN** that document is listed.

### Requirement: Existing Data Backfill

Existing `transcriptions` rows SHALL be represented as `documents` rows after migration.

#### Scenario: Existing transcription appears as Datei

- **GIVEN** a completed transcription existed before the migration
- **WHEN** the document backfill runs
- **THEN** a matching document row is created
- **AND** the document links back to the transcription detail.

### Requirement: Search And Filter

The Dateien library SHALL support filtering by visibility, source type, status, owner, favorite, tags, and date, plus full-text search over title and indexed content.

#### Scenario: Filter private files

- **WHEN** the user selects visibility filter `private`
- **THEN** only private files owned by that user are shown.
