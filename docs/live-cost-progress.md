# Live costs and backend-driven progress

Long-running transcription jobs use the existing authenticated SSE endpoint at
`/api/transcriptions/:id/stream`. Its status snapshot and ordered
`transcription_events` are mapped to the stable steps Upload, speech-to-text,
speaker diarisation, analysis, and done. If EventSource is unavailable or the
connection fails, the client falls back to bounded polling (3–15 seconds) and
cleans up timers and requests when the component unmounts or the backend leaves
an active status.

The ETA is deliberately approximate. It starts with conservative per-step
durations and scales remaining steps with the time observed for completed
steps. Completion, errors and cancellation always override an estimate.

## Session cost attribution

`usage_log.transcription_id` is additive and nullable. Existing callers and
rows remain valid; new transcription and Vexa meeting paths attach the owning
transcription. During a rolling schema deployment `logUsage` retries the legacy
insert when PostgreSQL reports a missing column.

Voxtral TTS usage is metered in synthesized Unicode characters, matching the
provider's per-character pricing. The legacy share-stream guard still accepts
historic audio-second rows and converts new character counts at 15 characters
per second to preserve its duration-based daily-limit setting.

`GET /api/usage/live?meetingId=<transcription-id>` validates that the meeting is
a Vexa transcription in the active organization and aggregates only rows with
the same organization and transcription IDs. It is rate-limited and uses the
existing `org.read` permission. The UI polls every 12 seconds and distinguishes
active, stale, finished and unavailable data. Costs are informational: Phase 4
does not stop an already-running meeting.

The dashboard uses the existing organization usage response and budget
guardrail helpers to show month spend against the effective most-restrictive
limit.
