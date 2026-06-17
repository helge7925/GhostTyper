# Capability: Transcript Aufgaben

## ADDED Requirements

### Requirement: Extract Proposed Tasks

GhostTyper SHALL extract proposed tasks from completed transcriptions and meetings.

#### Scenario: Extract tasks from meeting

- **GIVEN** a completed meeting transcript exists
- **WHEN** the user starts task extraction
- **THEN** GhostTyper creates proposed tasks
- **AND** each proposed task includes title, evidence, confidence, and source link.

### Requirement: Assign Workspace Members

GhostTyper SHALL assign extracted tasks directly to workspace members when a reliable match is possible.

#### Scenario: Exact email match

- **GIVEN** a transcript mentions `anna@example.com`
- **AND** a workspace member has email `anna@example.com`
- **WHEN** tasks are extracted
- **THEN** the matching task has `assignee_user_id` set to Anna's user ID.

#### Scenario: Ambiguous person match

- **GIVEN** a transcript says `Alex übernimmt das`
- **AND** multiple workspace members match `Alex`
- **WHEN** tasks are extracted
- **THEN** the task keeps `assignee_text = Alex`
- **AND** `assignee_user_id` remains null.

### Requirement: Review Before Acceptance

Extracted tasks SHALL default to `proposed` status and require user review before becoming active work.

#### Scenario: Accept proposed task

- **GIVEN** a proposed task exists
- **WHEN** the user accepts it
- **THEN** its status changes to `open`.

### Requirement: Source Navigation

Tasks SHALL link back to the transcript or document evidence that produced them.

#### Scenario: Open task source

- **WHEN** the user clicks a task source link
- **THEN** GhostTyper opens the source document
- **AND** scrolls or jumps to the relevant transcript segment when available.
