# Status: Retire Google Meet Bot

Last updated: 2026-07-16

## Current State

- **Implemented on branch `feat/retire-google-meet-bot`, 2026-07-16.**
  Stacked on `feat/remove-chat-knowledge-tasks` (branched from it, not
  from `main` — intentional, per the stacked-branch workflow used on
  this feature line).
- Prereq: none — tab-audio capture (`SystemAudioRecorder`) already
  shipped in GhostTyper natively, so no dependency on a separate
  tab-audio-capture change existed here (unlike the Romaco fork, which
  had to land `port-tab-audio-capture` first).
- Mirror implemented in romaco-scriptor:
  `feat/retire-google-meet-bot`, commit `415aabe`. Used as the reference
  implementation for this branch; not modified.

## What changed

- `components/MeetingStartForm.js`: `detectPlatform()` no longer
  returns `'google_meet'` (`MEET_REGEX` moved to a separate
  `isMeetUrl()` helper used only for the redirect hint). A pasted Meet
  URL shows an inline warning-styled hint
  (`meeting.start.meetBlocked.*` in `messages/{de,en}.json`) with a
  `next/link` deep-link to `/upload?preset=meet-tab-audio`, which
  closes the dialog on click. Submit stays disabled for Meet URLs
  (platform is `null`, same gate as any other unrecognised link) — no
  server round-trip is attempted. Placeholder text changed from a Meet
  example URL to a Teams one.
- `pages/upload.js`: new `UPLOAD_PRESETS['meet-tab-audio']` entry
  (`uploadMode: 'system-audio'`, `template: 'meeting'`,
  `diarize: true`) using the existing preset-via-query-param mechanism
  (`?preset=<id>` → `activePreset.config` → `AudioUploadForm`'s
  `presetConfig` prop). `AudioUploadForm` already supports
  `uploadMode: 'system-audio'` natively via `SystemAudioRecorder` and
  `ALLOWED_UPLOAD_MODES` — no new upload-mode wiring was needed, only
  the preset entry. If the browser doesn't support tab-audio capture,
  the existing `showSystemAudioTab` fallback in `AudioUploadForm`
  applies unchanged.
- `lib/api/vexa.js`: removed the `google_meet` entry from
  `MEETING_URL_PATTERNS` (outbound — feeds `parseMeetingUrl()`, used
  only by the meeting-start API route to turn a pasted URL into a
  bot-start request). `parseMeetingUrl()` now returns `null` for Meet
  URLs, same as any unsupported platform. Left untouched: `startBot`,
  `stopBot`, `updateBotConfig`, `getTranscript`,
  `setBotScreenContent`/`clearBotScreenContent`, `botSpeak`/
  `botSpeakStop`, `sendBotChatMessage` — all take `platform` as a plain
  string with no allow-list, so they remain fully read/write-tolerant
  of historic `meeting_platform='google_meet'` rows. Only comments were
  updated there to stop implying Meet is an active bot target.
- `pages/api/meetings/index.js`: removed `'google_meet'` from
  `SUPPORTED_PLATFORMS` (the outbound gate) and from `PLATFORM_LABELS`.
  Unlike the Romaco fork, GhostTyper's `PLATFORM_LABELS` is not dead
  code — it's used directly at the `platformLabel` call site (no
  separate inline map to keep in sync), so this was a single edit.
- i18n: `messages/de.json` + `messages/en.json` — removed the
  `meeting.start.platform.google_meet` key (dead now that
  `detectPlatform()` can't return it), trimmed "Google Meet" from
  `urlHint`, added `meeting.start.meetBlocked.{title,hint,cta}`, and
  updated `settings.meetingBotsHint` + `settings.integrations.vexa.description`
  to drop Meet from the bot's platform list and mention the tab-audio
  fallback.
- Docs: `README.md` / `README.de.md` — Meet dropped from the
  remote-meeting-bot platform list, one sentence added explaining why +
  pointing at tab/system audio capture. `docs/features-and-improvements.md`
  — same, one-line bullet update. `docs/vexa-integration.md` — added a
  callout at the top, removed the Google Meet row from the chat-auto-post
  support table (with a one-line explanation below it), updated the E2E
  test note to reference Teams/Zoom instead of a "Sandbox-Google-Meet".
  `docs/gdpr-setup.md` — checked, no Meet mentions existed, nothing to
  change.
- `CHANGELOG.md` — new bullet under the existing `[Unreleased]` /
  `### Removed` section (that section already existed for the
  chat/knowledge-base removal on the base branch; this change adds a
  second bullet rather than a new section).
- Tests (`tests/vexa-adapter.test.mjs`): replaced the two
  "recognises/normalises Google Meet URLs" tests with one asserting
  `parseMeetingUrl()` returns `null` for Meet URLs (the
  redirect/unsupported case). Added a read-tolerance regression test:
  `getTranscript()` called with no `baseUrl` fails identically
  (`Vexa baseUrl is not configured.`) for `google_meet`, `teams`,
  `zoom`, and `nextcloud_talk` — proving there's no platform-specific
  rejection inside the adapter that could someday break historic Meet
  reads. Net test count unchanged (2 removed, 2 added).

## Verification

- `npm test`: 140/150 pass, 0 fail, 10 skipped (pre-existing DB-only
  skips) — matches the `feat/remove-chat-knowledge-tasks` baseline
  exactly (2 Meet tests removed, 2 new tests added, net count
  unchanged).
- `npm run lint`: 0 errors. The 2 pre-existing `react-hooks/exhaustive-deps`
  warnings in `pages/transcriptions.js` remain (unrelated, left as-is
  per instructions).
- Grep sweep (`google_meet`, `meet.google`, `Google Meet` across
  `components/pages/lib/messages/docs/tests/READMEs/CHANGELOG.md`):
  every remaining hit is either (a) an explanatory comment/doc line
  about the removal, (b) a read-tolerance note
  (`meeting_platform='google_meet'` historic rows), or (c) the
  redirect-hint copy itself (which necessarily still says "Google
  Meet" to explain the block to the user). One historic hit was
  deliberately left untouched: `CHANGELOG.md`'s `[0.3.0]` entry
  ("Bot tritt Google Meet, Microsoft Teams oder Zoom bei…") documents
  what shipped at that past release and is not a statement about
  current behaviour. No outbound/bot-start code path references Meet
  anymore.
- Manually traced every `row.meeting_platform` read site
  (`pages/api/meetings/[id].js`, `pages/api/meetings/[id]/config.js`,
  `pages/api/transcriptions/[id].js`, `pages/api/transcriptions/[id]/stream.js`,
  `pages/api/webhooks/vexa.js`, `pages/api/admin/vexa/reconcile.js`,
  `lib/vexa-bridge.js`, `lib/gdpr-chat-poster.js`,
  `lib/share-chat-poster.js`, `lib/in-meeting-overlay.js`,
  `lib/in-meeting-audio.js`, `lib/integrations.js`) — all pass the
  stored platform string straight through with no allow-list, so
  historic `google_meet` rows keep working end to end (transcript
  fetch, bot stop, chat-notice posting, in-meeting overlay/audio,
  webhook reconciliation). Only the *new-bot-start* gate in
  `pages/api/meetings/index.js` and the outbound URL parser in
  `lib/api/vexa.js` were changed.

## Open points

- No dedicated `next/link`-based or DOM-rendering test exists for
  `MeetingStartForm.js` (this repo's `npm test` suite is pure
  `node --test` over `lib/`, no jsdom/RTL) — the Meet-URL-blocked UI
  path (`isMeetUrl` → hint → `/upload?preset=meet-tab-audio` link) was
  verified by code review and the lint pass, not by an automated
  component test. If a component-testing harness is ever added to this
  repo, this is a good candidate to backfill.
- Did not touch any platform-agnostic sections of
  `docs/vexa-integration.md` that don't mention Meet specifically
  (e.g. the two-stage opt-in section, troubleshooting table).
- Kept read-tolerant per the rule in this task: everywhere it was
  ambiguous whether a code path was outbound (bot-start) or read-side
  (existing-row management), it was left untouched and treated as
  read-side.
