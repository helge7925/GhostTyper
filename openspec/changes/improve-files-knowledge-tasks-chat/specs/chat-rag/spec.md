# Capability: Chat RAG and Sources

## ADDED Requirements

### Requirement: Automatic Document Context

Chat SHALL automatically attach the current document as context when opened from a document detail page.

#### Scenario: Open chat from document

- **GIVEN** a user is viewing a readable document
- **WHEN** the user opens chat for that document
- **THEN** GhostTyper creates or reuses a chat conversation
- **AND** attaches the document as focused retrieval context.

### Requirement: Multiple Context Attachments

Chat SHALL support multiple context attachments including documents, folders, and knowledge bases.

#### Scenario: Add knowledge base to chat

- **WHEN** the user adds a knowledge base to chat context
- **THEN** future messages can retrieve chunks from that knowledge base
- **AND** the active context is visible as a chip in the chat header.

### Requirement: Streaming Responses

Chat SHALL stream assistant responses progressively when the provider supports streaming.

#### Scenario: Stream answer

- **WHEN** the user sends a chat message
- **THEN** the assistant answer appears progressively
- **AND** the user can stop generation before completion.

### Requirement: Source Citations

Document-grounded chat answers SHALL include citations for claims derived from retrieved context.

#### Scenario: Answer with cited source

- **GIVEN** retrieval finds a relevant transcript chunk
- **WHEN** the assistant uses it in an answer
- **THEN** the answer includes a source citation
- **AND** the UI shows a clickable source chip.

#### Scenario: No relevant source

- **GIVEN** retrieval finds no relevant chunk
- **WHEN** the user asks a document-grounded question
- **THEN** the assistant states that no reliable source was found in the selected context.

### Requirement: Chat Message Actions

Chat messages SHALL support copy, regenerate, and edit-from-here actions.

#### Scenario: Regenerate assistant response

- **WHEN** the user clicks regenerate on an assistant message
- **THEN** GhostTyper re-runs the conversation from the preceding user message
- **AND** stores the regenerated answer with metadata linking to the previous message.

### Requirement: Follow-Up Prompts

GhostTyper SHALL generate follow-up prompt suggestions after assistant responses when the follow-up feature is enabled.

#### Scenario: Click follow-up

- **WHEN** the user clicks a follow-up prompt
- **THEN** the prompt is sent or inserted according to the configured behavior.
