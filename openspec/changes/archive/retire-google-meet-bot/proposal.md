# Change: Retire Google Meet from the Remote-Meeting Bot

## Why

Google has deployed server-side bot tracking on Meet: Vexa bots land on a
hard rejection page — not a CAPTCHA, a block (verified by the operator,
July 2026). Keeping Meet in the bot platform picker produces guaranteed
failures. The robust, platform-independent alternative already exists:
tab-audio capture (`SystemAudioRecorder`) records any browser-based
meeting locally, with no bot to detect.

Decision 2026-07-16: **remove Meet completely** from the bot path (not
just hide) and steer users to tab audio.

## Decisions Captured

- Google Meet SHALL be removed from bot URL detection
  (`MEET_REGEX` in `components/MeetingStartForm.js`), the platform
  picker, `lib/api/vexa.js` platform mappings and platform-specific chat
  formatting, and operator docs.
- Pasting a Meet URL into the meeting form SHALL show a friendly
  redirect: explain the Google block and deep-link to the tab-audio
  recorder on the upload page.
- Teams and Zoom SHALL remain supported for now; their bot-detection risk
  is noted in docs. Existing Meet transcriptions stay readable (platform
  value `google_meet` remains valid for historic rows).
- Tab-audio SHALL become the documented primary path for browser-based
  meetings (README + in-app hint).

## What Changes

- `components/MeetingStartForm.js`: remove Meet detection/picker entry, add
  redirect hint for meet.google.com URLs.
- `lib/api/vexa.js`: drop `google_meet` from outbound platform mapping;
  keep read-side tolerance for historic rows.
- Docs (`docs/vexa-integration.md`, READMEs): Meet section replaced by
  tab-audio guidance.
- i18n: new keys for the redirect hint (de/en).

## Impact

- No data migration; historic Meet meetings unaffected.
- Mirrored change in Romaco Scriptor (same-named spec there).
