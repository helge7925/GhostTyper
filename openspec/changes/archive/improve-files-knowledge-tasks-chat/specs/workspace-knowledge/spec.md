# Capability: Workspace Wissen

## ADDED Requirements

### Requirement: Knowledge Bases

GhostTyper SHALL allow workspace users with permission to create knowledge bases containing documents from `Dateien`.

#### Scenario: Create knowledge base

- **WHEN** a permitted user creates a knowledge base with a name
- **THEN** GhostTyper stores it in the active workspace
- **AND** it appears in the `Workspace Wissen` page.

### Requirement: Add Documents To Knowledge

Users SHALL be able to add readable documents to a knowledge base.

#### Scenario: Add workspace document

- **GIVEN** a user can read a workspace document
- **WHEN** the user adds it to a knowledge base
- **THEN** a knowledge item is created
- **AND** the document becomes retrievable through that knowledge base.

#### Scenario: Block private document from shared knowledge

- **GIVEN** a document is private to another user
- **WHEN** a user attempts to add it to a knowledge base
- **THEN** the API rejects the request.

### Requirement: Retrieval Modes

Knowledge items SHALL support `focused`, `full_context`, and `off` retrieval modes.

#### Scenario: Focused retrieval

- **GIVEN** a knowledge item is in `focused` mode
- **WHEN** chat queries the knowledge base
- **THEN** GhostTyper injects only the most relevant indexed chunks.

#### Scenario: Full context retrieval

- **GIVEN** a knowledge item is in `full_context` mode and below the configured size limit
- **WHEN** chat queries the knowledge base
- **THEN** GhostTyper injects the whole document content.

### Requirement: Citation-Ready Chunks

Documents in knowledge bases SHALL be indexed into chunks with metadata sufficient to generate clickable citations.

#### Scenario: Transcript chunk citation

- **GIVEN** a transcript chunk includes start and end seconds
- **WHEN** chat cites that chunk
- **THEN** the citation can link back to the corresponding transcript time range.

### Requirement: Stored Cortecs Embeddings

Indexed chunks SHALL store embeddings generated through the Cortecs API for semantic retrieval.

#### Scenario: Store chunk embedding

- **GIVEN** a document chunk has been created
- **WHEN** the indexing worker processes embeddings
- **THEN** GhostTyper calls the configured Cortecs embedding endpoint
- **AND** stores the returned vector with provider, model, dimensions, and hash metadata.

#### Scenario: Semantic reranking without pgvector

- **GIVEN** chunk embeddings are stored as regular Postgres arrays
- **WHEN** chat retrieves focused context
- **THEN** GhostTyper can rank candidate chunks by cosine similarity in application code
- **AND** pgvector is not required for correctness.
