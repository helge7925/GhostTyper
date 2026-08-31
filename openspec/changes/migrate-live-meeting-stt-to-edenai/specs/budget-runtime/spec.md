# Capability: Budget Runtime

## ADDED Requirements

### Requirement: Provider-Aware Meeting Billing Checkpoint

GhostTyper SHALL resolve the live-meeting STT billing checkpoint against
the provider that actually transcribes live-meeting audio (Mistral,
direct — see the `mistral-provider` capability), and SHALL NOT fail a
meeting due to an unconfigured provider that is not the one actually
transcribing it.

#### Scenario: Meeting checkpoint resolves the Mistral configuration

- **GIVEN** a meeting is in progress
- **WHEN** the periodic STT billing checkpoint runs
- **THEN** it resolves pricing and usage against the workspace's (or
  operator-fallback) Mistral configuration, not OpenRouter

#### Scenario: Unconfigured OpenRouter does not block the meeting

- **GIVEN** a meeting's live transcription is configured with a valid
  Mistral key, and OpenRouter has no configured API key at all
- **WHEN** the periodic STT billing checkpoint runs
- **THEN** the meeting continues normally — OpenRouter's configuration
  state is irrelevant to this checkpoint
