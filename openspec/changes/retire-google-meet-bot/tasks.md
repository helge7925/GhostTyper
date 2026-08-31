# Tasks: Retire Google Meet Bot

- [x] Remove Meet from `MEET_REGEX`/platform detection in
      `components/MeetingStartForm.js`; add meet.google.com → tab-audio
      redirect hint (i18n de/en).
- [x] Remove `google_meet` from outbound platform mapping in
      `lib/api/vexa.js`; keep read tolerance for historic rows; adjust
      platform-specific chat formatting.
- [x] Sweep UI for Meet mentions (icons, labels, onboarding, settings).
- [x] Update docs: vexa-integration, READMEs (Meet → tab audio; note
      Teams/Zoom bot-detection risk).
- [x] Tests: platform-detection unit tests updated; add test that Meet
      URLs are rejected with the redirect code.
- [x] Verify: start-meeting flow for Teams/Zoom unaffected; Meet URL
      shows hint; historic Meet transcription still renders.
