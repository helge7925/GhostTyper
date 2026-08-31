# Design: Migrate Text-To-Speech To EdenAI

## Model Selection: google/gemini-2.5-flash-tts, voice "Kore" (2026-08-30)

EdenAI's `/v3/info/audio/tts` catalogue lists 29 `audio/tts/<provider>[/
<variant>]` models. Filtering to EU region first (per the standing rule)
before any quality test leaves 16 candidates; `elevenlabs`, `deepgram`,
`openai`, `lovoai` (13 model variants total) are US-only and were
excluded without testing.

Six EU candidates were tested live against the same German text
(umlauts, a date, a money amount): `amazon/standard`, `amazon/neural`,
`google/wavenet`, `google/neural2`, `microsoft/neural`,
`google/gemini-2.5-flash-tts`.

### Round 1: default voice (no `voice` field sent)

Every sample was fed back through the app's already-verified `gladia`
batch transcription and diffed against the source text — an
intelligibility proxy, not a naturalness one (see "Testing Methodology"
below).

| Model | Round-trip result |
|---|---|
| amazon/standard | Garbled: "Summe von Fassende" instead of "Zusammenfassung" |
| google/wavenet | Garbled: "Grassee", wrong date, "drei Affäre.Besprachen" |
| amazon/neural | Mostly correct, date garbled |
| microsoft/neural | Heavily garbled, largely unintelligible |
| google/neural2 | Identical output to google/wavenet (same defaults) — garbled |
| google/gemini-2.5-flash-tts | Correct except minor casing |

This confirmed a real pitfall, not just a per-model quality signal:
**omitting `voice` lets EdenAI pick a bad default for most providers.**

### Round 2: explicit, known-good German voice id

Re-run with `amazon/standard`→"Marlene", `google/wavenet`→
"de-DE-Wavenet-F", `amazon/neural`→"Vicki", `microsoft/neural`→
"de-DE-KatjaNeural", `google/neural2`→"de-DE-Neural2-F",
`google/gemini-2.5-flash-tts`→"Kore".

| Model (voice) | Round-trip result | $/1000 chars (normalized) | Region |
|---|---|---|---|
| amazon/standard (Marlene) | Perfect | **0.004** | EU |
| google/wavenet (de-DE-Wavenet-F) | Perfect | **0.004** | EU |
| google/gemini-2.5-flash-tts (Kore) | Perfect | 0.0062 | EU |
| amazon/neural (Vicki) | Perfect | 0.016 | EU |
| google/neural2 (de-DE-Neural2-F) | Perfect | 0.016 | EU |
| microsoft/neural (de-DE-KatjaNeural) | **"12.500 Euro" → "12.000 aus in 500 Euro"** | 0.016 | EU |

`microsoft/neural` disqualified: a money-amount corruption is a real
defect for a business-transcription tool, independent of price — a
premium-tier voice made it *worse* on this specific failure mode, not
better, so no further retry was warranted.

Gemini's per-minute price ($0.006/min) was normalized against this
test's own measured rate (194 characters in 11.95s ≈ 974 chars/min) to
get the $/1000-char figure above, for a fair comparison against the
per-character-billed models.

### Testing Methodology Note: round-trip correctness is not naturalness

An ASR model transcribes flat, monotone "standard"-tier speech just as
correctly as fluent, natural speech — the round-trip proxy can only rule
out genuinely broken/unintelligible output (as it did in round 1 and for
`microsoft/neural`), never confirm that a voice sounds acceptable to a
human listener. This is a hard limitation of a text-based test
methodology applied to an audio-quality question, not a gap that could
be closed by testing harder. The three cheapest, round-trip-correct EU
candidates (`amazon/standard`, `google/wavenet`, `google/gemini-2.5-
flash-tts`) were rendered as real audio files and sent to the user
directly for an actual listening comparison, alongside the full
cost/region/round-trip table above (`amazon/neural`/`google/neural2`
were withheld from the initial batch — both round-trip-correct but 2.6×
gemini's price for a mid-2020s-generation neural voice — offered as a
follow-up if none of the three cheap options sounded acceptable; not
needed). The user chose `google/gemini-2.5-flash-tts`, voice `"Kore"`: a
modern LLM-based synthesis model, EU region, marginally pricier than the
bottom tier.

## `synthesizeSpeechEdenAi`

EdenAI's `tts` subfeature is **sync** (`POST /v3/universal-ai`, confirmed
via `GET /v3/info/audio/tts` — `"mode": "sync"`), unlike STT's
async-job model. Response shape:
`{status, cost, provider, output: {audio_resource_url}, error,
original_response}` — a signed CloudFront URL, not inline audio bytes,
so the function makes a second request to fetch it before reusing
`lib/tts.js`'s `mp3ToCanonicalPcm` (now exported, previously private) for
the exact same PCM normalization every other TTS path in this app
already produces. This mirrors `openRouterTts`'s shape precisely (a
`Buffer` with `.providerRequestId`/`.usage`), except
`providerRequestId` is always `null` — EdenAI's sync TTS response has no
per-request id field to surface, unlike OpenRouter's generation-id
header.

A sync-mode logical failure (e.g. unsupported language) returns HTTP 200
with `{status:"fail", output:null, error:{message}}` — the same shape
`probeEdenAiUniversal` already documented for other universal-ai
capabilities — so `synthesizeSpeechEdenAi` checks `result.status` and
`result.output?.audio_resource_url` explicitly rather than trusting
`edenAiJsonRequest`'s HTTP-level `.ok` check alone.

**Never send this without an explicit `voice`.** Round 1 above is the
concrete evidence: the provider default produced wrong or unintelligible
German for 5 of 6 models. `EDENAI_TTS_DEFAULT_VOICE` (`lib/edenai.js`)
is the built-in fallback whenever a workspace hasn't set its own
`ttsVoices[model]` override — this is not "a reasonable default in case
the field is empty," it is required for the feature to work at all.

## Downloading `audio_resource_url`: safeFetch and a real, but undocumented, stable host

The `audio_resource_url` is provider-returned, not this app's own fixed
endpoint, so it goes through `safeFetch` (`lib/network-guard.js`'s SSRF
guard) rather than a raw `fetch` — the same reasoning `openRouterTts`
already applies to its own upstream call.

Live testing found every one of 12 test calls (6 models × 2 rounds)
returned the identical CloudFront hostname,
`d14uq1pz7dzsdq.cloudfront.net` — only the path and signed-URL query
differ per file. This is EdenAI's own CDN distribution, not a
per-request or per-provider random subdomain, so it's a safe, stable
entry for `OUTBOUND_ALLOWED_HOSTS` (added to `.env.example`). It is,
however, an **empirically observed constant, not a documented EdenAI API
contract** — nothing guarantees EdenAI won't rotate their CDN
infrastructure in the future. If that happens, `synthesizeSpeechEdenAi`
fails closed (`safeFetch` throws `OUTBOUND_HOST_NOT_ALLOWLISTED`) rather
than silently succeeding against an unexpected host — the correct
failure mode, but worth knowing this environment variable may need a
follow-up update someday for a reason outside this app's own control.

## Deliberately Out Of Scope

- `speed`, `speaking_pitch`, `speaking_volume` (all present in EdenAI's
  `tts` input schema) are not wired up — `openRouterTts` never exposed
  these either, so this stays a like-for-like provider swap, not a new
  feature.
- The full `migrate-chat-tts-and-decommission-openrouter` bundle (chat/
  analysis call sites, full OpenRouter teardown) is untouched — this
  change is scoped to TTS only, same boundary every other capability
  migration in this sequence has kept.

## Risks / Trade-offs

- The round-trip STT proxy cannot validate naturalness (see "Testing
  Methodology" above) — the final decision rests on the user's own
  listening test of the three finalist samples, not on anything this
  change's automated evidence alone could prove.
- `d14uq1pz7dzsdq.cloudfront.net`'s stability is an empirical observation
  across 12 calls in one test session, not a guarantee — see the
  `safeFetch` section above for the fail-closed behavior if it ever
  changes.
- `providerRequestId` is always `null` for EdenAI TTS (no per-request id
  in the sync response) — any downstream tooling that expects a
  request id for support/debugging purposes will see `null` for EdenAI-
  rendered audio specifically, unlike OpenRouter's.
