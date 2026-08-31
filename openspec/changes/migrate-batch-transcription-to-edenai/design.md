# Design: Migrate Batch Transcription To EdenAI

## Two Providers, One Job

`processClaimedJob()` resolves one OpenRouter config today and uses it for
both the STT block and the analysis block. After this change:

- STT block: `resolveActiveProviderConfig({capability:'transcription'})`
  replaces the local hardcoded `transcriptionProvider`. `executeChunk`
  passes `provider: activeTranscription.provider` and branches to
  `transcribeAudio`/`transcribeAudioEdenAi`.
- Analysis block: **stays exactly as it is today** —
  `resolveOpenRouterConfig`/hardcoded `provider:'openrouter'`, untouched.
  See "Design correction" below for why this changed from the plan
  originally written here.
- The catalogue probe that decides `verboseJsonSupported` (checks whether
  the configured transcription model supports timestamped
  `response_format: verbose_json`) is an OpenRouter-specific
  `supported_parameters` check with no EdenAI equivalent field, and
  stays gated behind `if (activeTranscription.provider !== 'edenai')`.

This is the largest structural edit of this change: one function now
juggles two independently-resolved providers for two different halves of
the same job.

## Design correction: analysis stays hardcoded to OpenRouter, not router-routed (2026-08-30)

This section originally planned to route the analysis block through
`resolveActiveProviderConfig({capability:'chat'})` too, "for consistency,
not a special case" — reasonable when it was written (before
`hardcode-edenai-models` landed), since `chat` had no hardcoded EdenAI
model yet and that call would always have resolved to OpenRouter anyway.

That assumption no longer holds: `chat` now has a real, activatable
EdenAI model (`mistral/mistral-small-latest`), and other call sites
already route through it (`pages/api/text-optimization.js`,
`pages/api/translate.js`, `pages/api/translate/file.js`). If this
change's analysis block also routed through the same resolver, any
workspace that had already activated EdenAI `chat` for those other
features would silently start sending upload-transcription analysis to
EdenAI too — a real behavior change this change never asked for or
tested, and outside its own stated scope (a pure STT provider swap).

The standing plan (see the master plan file's "Design-Philosophie-
Korrektur" section) explicitly lists `lib/transcription-worker.js`'s
analysis/chat call site as one of five left untouched until
`migrate-chat-tts-and-decommission-openrouter`. This change follows that:
the analysis block keeps its own hardcoded `resolveOpenRouterConfig`
call, completely unchanged — only the STT block was touched.

## Model Selection: gladia (2026-08-30)

Live-tested 7 of the 9 `audio/speech_to_text_async` vendors EdenAI
exposes (openai, deepgram/nova-3, gladia, microsoft, amazon, assembly,
google — skipped deepgram's older `base`/`enhanced` tiers since `nova-3`
already represents that vendor's current generation) against locally
synthesized German/English business audio (macOS `say`, never real user
recordings — see the "Testing Methodology" note below). Test content: a
short business update (amounts, a date, a product name) plus a harder
follow-up round (revenue figures, an invented surname, a phone number).

| Provider | Region | $/min | Result |
|---|---|---|---|
| assembly | US | $0.011 | **Disqualified** — dropped numeric amounts entirely from the German transcript |
| google | EU | $0.024 | **Disqualified** — no punctuation or capitalization at all, either language |
| amazon | EU | $0.024 | Weakest of the rest: lowercase heading defect, worst brand-name mishearing |
| microsoft | EU | $0.0168 | German output had a genuinely garbled word and a missing sentence break |
| deepgram/nova-3 | **US** | $0.0052 | Clean, correct, working diarization (real per-word speaker entries); numbers left spelled-out rather than digit-normalized |
| openai | **US** | $0.006 | Clean, correct, best number/date formatting; **no diarization at all** (Whisper-based, structurally absent regardless of price) |
| **gladia** | **EU** | $0.0102 | Clean, correct, diarization structure present |

openai and gladia tied on raw output quality and both beat every other
candidate. Cost alone would favor `deepgram/nova-3` (roughly half
gladia's price, with demonstrably *working* diarization, unlike openai).
This exact trade-off — cheapest-but-US (`deepgram/nova-3`) vs.
same-quality-tier-but-EU (`gladia`) — was put to the user explicitly
rather than decided silently. The user chose gladia and set a standing
rule for every future `EDENAI_HARDCODED_MODEL` decision: minimize cost
subject to a fixed quality bar *and* EU region, not cost alone — EU
region is a hard constraint here, not a soft preference to trade away for
a cheaper US option. `deepgram/nova-3` and `openai` are both US-only,
which is why neither qualifies despite being cheaper or (for deepgram)
diarization-capable.

Reproducibility: gladia's German test text was rerun 3 times total
(original + 2 reruns) with byte-identical output. A follow-up harder
business text (new content, avoiding the first round's proper nouns) was
also rerun 3 times with byte-identical, fully correct output.

### Testing Methodology Note: bad TTS voices, not bad STT

An early two-speaker diarization test kept producing garbled text for the
*second* speaker specifically, regardless of which STT engine processed
it (gladia, openai, and deepgram all failed on the same audio the same
way). This was traced to the audio source, not any EdenAI provider:
macOS's non-default `say` voices ("Reed", "Eddy") produce genuinely
poor-quality synthetic audio — confirmed decisively by feeding the exact
sentence that transcribed perfectly from `say -v Anna` through
`say -v Eddy` instead and getting nonsense back from gladia every time,
independent of sentence content or two-speaker concatenation. Lesson for
future EdenAI audio-capability verification (OCR doesn't need this;
`liveTranscription` will): stick to default/premium-tier macOS voices
("Anna", "Daniel"), not every voice `say -v '?'` lists. This also means
multi-speaker diarization was never cleanly validated end-to-end in this
round — gladia's diarization *machinery* is confirmed to run (structured
`entries` returned, even on the garbled audio), but a real quality read
on it is deferred to whenever diarization adoption itself is scoped, per
"Deliberately Out Of Scope" below.

## `transcribeAudioEdenAi`

EdenAI's speech-to-text is confirmed async/job-based
(`POST /v3/universal-ai/async` with `model:
"audio/speech_to_text_async/{provider}"` → poll
`GET /v3/universal-ai/async/{job_id}` for `status`/`results`, per
`add-edenai-provider-foundation`'s confirmed v3 API surface). This is a
**good fit** for
batch transcription specifically: the existing chunk-loop architecture
(20-minute chunks with 5-second overlap, one `executeReservedSpend`
reservation per chunk, 30-minute `reservationMs`) already tolerates
multi-second per-chunk latency. `transcribeAudioEdenAi` submits a job for
one chunk, polls it to completion, and returns
`{text, segments, usage, model, providerRequestId}` — the same shape
`requestTranscriptionFile` returns today — so nothing in
`lib/ai-service.js`'s outer `transcribeAudio` loop, its overlap-stitching
(`stripOverlapPrefix`), or its budget wiring needs to change.

## Deliberately Out Of Scope

EdenAI STT vendors offer native diarization and (vendor-dependent) native
custom-vocabulary/keyword-boosting — real quality improvements over
today's manual-speaker-assignment UI and Groq-only best-effort
context-bias hack (`buildContextBiasProviderOptions`). This change does
not adopt either: it is a pure provider swap, matching today's behavior
exactly, so it can be verified independently of any UI/UX change. Native
diarization/vocabulary adoption is recorded as a follow-on product change,
not a task here.

## Risks / Trade-offs

- Async job polling adds latency and failure modes (job never completes,
  polling times out) that a synchronous OpenRouter call doesn't have.
  **Resolved**: `transcribeChunkEdenAi` (in `transcribeAudioEdenAi`) polls
  on a bounded interval (`EDENAI_STT_POLL_INTERVAL_MS`, default 3s) with
  a bounded deadline (`EDENAI_STT_POLL_TIMEOUT_MS`, default 10 minutes
  per chunk — generous slack over the sub-minute turnaround seen in live
  testing on short clips, not a measured worst case for a full 20-minute
  chunk) and throws a distinct `EdenAiError` (`code:
  'EDENAI_REQUEST_FAILED'`, `status: 504`) on timeout, separate from both
  `MODEL_UNAVAILABLE` and a genuine job-`failed` error.
- If EdenAI's chosen vendor model doesn't support the audio codec a
  particular chunk was compressed to, this surfaces per-chunk rather than
  per-job — the existing chunk loop already treats each chunk
  independently (unmodified by this change), so a mid-file provider
  error propagates the same way it already does for OpenRouter today:
  the job fails, chunks already billed stay billed, no code in this
  change's scope changes that behavior. **Not independently tested**
  here beyond the shared loop being unmodified — live testing used only
  WAV input and never exercised an actual codec-rejection response from
  gladia, so this remains a real, untested risk rather than a verified
  non-issue.
