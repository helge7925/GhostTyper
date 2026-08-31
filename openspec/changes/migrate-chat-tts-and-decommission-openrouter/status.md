# Status: Migrate Chat, Analysis And TTS To EdenAI, Decommission OpenRouter

Last updated: 2026-08-30

## Current State

- **Planned** for this change's remaining scope. Only the full
  OpenRouter decommission (section 5 of tasks.md, plus the small
  leftover `chat` `OPERATIONS`-map task 1.3) is still open — everything
  else this change originally owned has landed elsewhere, see the two
  split notes below. Depends on `add-edenai-provider-foundation` and
  section 5 should only begin once `migrate-translation-to-edenai`,
  `migrate-batch-transcription-to-edenai`, `migrate-ocr-extraction-to-
  edenai`, `migrate-live-meeting-stt-to-edenai`, `migrate-tts-to-edenai`
  and `migrate-chat-to-edenai` have each run successfully in production
  for a soak period — this change's decommission tasks are irreversible
  in practice once OpenRouter's code is deleted. None of them have run
  in production yet (all still local/dev-verified only), so section 5
  has not been started.

## TTS pulled out into its own change (2026-08-30)

Section 3.2/6.1 (TTS call sites, TTS tests) and the TTS half of
section 1.2/1.3 (the `edenAiTts`-shaped adapter and its `OPERATIONS`
entry) are **done**, but not by this change — they landed in
`migrate-tts-to-edenai`, a new, separately-tracked change, following the
same reasoning already applied to every other capability in this
migration sequence: TTS's model decision only depended on its own live
comparison test, not on the (separate, much larger, not-yet-started)
chat migration and OpenRouter decommission this change still owns. See
`migrate-tts-to-edenai/status.md` for the full model-selection evidence
and implementation.

## Chat/analysis pulled out into its own change (2026-08-30)

Section 3.1 (the five chat/analysis call sites), the chat half of
section 1.1/1.2, and section 2 (the pre-cutover structured-output
probe) are also **done**, landed in `migrate-chat-to-edenai` — same
reasoning as the TTS split. This is the change that actually did the
live verification section 2's own note below flagged as the highest-
consequence unverified assumption in the whole migration: it found and
fixed a real defect (`generateTemplateEdenAi` returning JSON-wrapped
output instead of plain text) before calling the migration done, not
after. See `migrate-chat-to-edenai/status.md` for the full evidence.

This change's remaining scope is now **only**: the small leftover
`chat` `OPERATIONS`-map entry in task 1.3 (already-correct from the
foundation phase, confirmed by `migrate-chat-to-edenai` — effectively
nothing left to do there either), and the full OpenRouter decommission
(section 5).

## Outstanding

- Section 5 (full OpenRouter decommission) — the only substantive
  remaining scope. Gated on a production soak period, per "Current
  State" above.
- Legal/compliance sign-off on EdenAI's data-processing terms (per
  `add-edenai-provider-foundation`'s Risks section) should be obtained
  before this change's decommission tasks run for any workspace handling
  real customer meeting or document content.
