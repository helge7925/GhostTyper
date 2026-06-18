# Capability: UI-Polish – Tabellen, Wake Lock, Upload-Limit, Textoptimierung, Dateiansicht

## Requirement: Table Creation Only as Analysis Mode

GhostTyper SHALL offer table extraction only as a regular analysis mode. Predefined table-template filling SHALL be removed from the UI.

### Scenario: User uploads audio for table extraction

- **WHEN** a user selects the `data_table` analysis mode during upload or visits `/datentabelle`
- **THEN** GhostTyper creates a free-form data table analysis.
- **AND** there is no separate "fill predefined table template" workflow.

### Scenario: Predefined table template UI is gone

- **GIVEN** the user is on settings, dashboard, command palette, meeting start, or upload page
- **THEN** no entry point for creating or using predefined table templates is visible.

### Scenario: Legacy table-template rows remain readable

- **GIVEN** an existing transcription was created from a table template
- **THEN** it still renders in the table editor/viewer.

## Requirement: Mobile Recording Wake Lock

GhostTyper SHALL keep the screen awake while audio recording is active.

### Scenario: Recording starts on a supported mobile browser

- **WHEN** the user starts a recording
- **THEN** GhostTyper requests a screen wake lock.
- **AND** the recording continues when the screen turns off.

### Scenario: Recording stops

- **WHEN** the user stops the recording or an error occurs
- **THEN** the wake lock is released.

### Scenario: Tab becomes visible again while recording

- **GIVEN** a recording is active and the tab lost the wake lock (e.g. tab switched)
- **WHEN** the tab becomes visible again
- **THEN** GhostTyper re-acquires the wake lock.

## Requirement: 500 MB Upload Limit

GhostTyper SHALL allow audio/OCR/translation file uploads up to 500 MB.

### Scenario: User uploads a 300 MB audio file

- **WHEN** the user selects a file ≤ 500 MB
- **THEN** the upload proceeds.

### Scenario: User uploads a file larger than 500 MB

- **WHEN** the user selects a file > 500 MB
- **THEN** GhostTyper shows a clear "max. 500 MB" error.

### Scenario: Upload hint strings

- **GIVEN** the user sees upload hints in German or English
- **THEN** the hints say "500 MB" instead of "50 MB".

## Requirement: Text Optimization Always Uses DeepSeek Flash

GhostTyper SHALL always use `deepseek-v4-flash` for text optimization.

### Scenario: User optimizes text

- **WHEN** the user submits text on `/textoptimierung`
- **THEN** no model selector is shown.
- **AND** the backend uses `deepseek-v4-flash` regardless of user settings.

## Requirement: Wider File Detail Views

GhostTyper SHALL use more horizontal space for file detail pages.

### Scenario: User opens a document detail page

- **WHEN** the user visits `/documents/[id]`
- **THEN** the content container uses a wider max-width.

### Scenario: User opens a transcription detail page

- **WHEN** the user visits `/transcriptions/[id]`
- **THEN** the content container uses a wider max-width.

## Requirement: Workspace Knowledge Sharing Visible

GhostTyper SHALL indicate that workspace knowledge bases are shared with the workspace.

### Scenario: User opens a knowledge base

- **WHEN** the user views a knowledge base detail
- **THEN** a "shared in workspace" indicator is visible near the title.
