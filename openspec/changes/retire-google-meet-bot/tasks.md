# Tasks: Retire Google Meet Bot

- [ ] Remove Meet from `MEET_REGEX`/platform detection in
      `components/MeetingStartForm.js`; add meet.google.com → tab-audio
      redirect hint (i18n de/en).
- [ ] Remove `google_meet` from outbound platform mapping in
      `lib/api/vexa.js`; keep read tolerance for historic rows; adjust
      platform-specific chat formatting.
- [ ] Sweep UI for Meet mentions (icons, labels, onboarding, settings).
- [ ] Update docs: vexa-integration, READMEs (Meet → tab audio; note
      Teams/Zoom bot-detection risk).
- [ ] Tests: platform-detection unit tests updated; add test that Meet
      URLs are rejected with the redirect code.
- [ ] Verify: start-meeting flow for Teams/Zoom unaffected; Meet URL
      shows hint; historic Meet transcription still renders.
