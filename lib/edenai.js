import { normalizeModelId } from './openrouter.js';

export const EDENAI_BASE_URL = 'https://api.edenai.run/v3';

export const EDENAI_CAPABILITIES = Object.freeze([
  'chat',
  'transcription',
  'liveTranscription',
  'tts',
]);

// Chat models use OpenAI-compatible `provider/model-id` strings against
// /chat/completions. Every other capability uses EdenAI's own
// `category/subfeature/provider` strings against /universal-ai (or
// /universal-ai/async when the subfeature name ends `_async`). `category`/
// `subfeature` are kept as separate fields (not one combined string)
// because they're used to build the `/universal-ai` request URL/model id
// separately.
//
// tts's subfeature is `tts`, not `text_to_speech` — confirmed live
// against a real account 2026-08-28 (GET /v3/info/audio/text_to_speech
// 400s with `{"available_subfeatures":["tts","speech_to_text_async"]}`);
// every earlier source (including EdenAI's own `edenai/docs` reference)
// used the longer, wrong name. See
// add-edenai-provider-foundation/status.md's 2026-08-28 live-verification
// entry.
export const EDENAI_CAPABILITY_MODEL_SHAPE = Object.freeze({
  chat: Object.freeze({ kind: 'chat' }),
  transcription: Object.freeze({ kind: 'universal', category: 'audio', subfeature: 'speech_to_text_async' }),
  liveTranscription: Object.freeze({ kind: 'universal', category: 'audio', subfeature: 'speech_to_text_async' }),
  tts: Object.freeze({ kind: 'universal', category: 'audio', subfeature: 'tts' }),
});

// One hardcoded model per capability, chosen through a real head-to-head
// comparison against production EdenAI — not an admin-selected value
// from a live catalogue (see hardcode-edenai-models/design.md for the
// evidence and the reasoning behind dropping catalogue-driven selection
// entirely). `null` means "not yet decided" — that capability cannot be
// activated (see pages/api/organizations/integrations/edenai/activate.js's
// MODEL_NOT_YET_CONFIGURED) until a comparison test picks one.
//
// chat: 'mistral/mistral-small-latest' — Mistral AI (France), Apache-2.0
// licensed (genuinely open-weight), chosen 2026-08-28 after `anthropic/
// claude-sonnet-5` (which passed the same tests perfectly, see below) was
// ruled out on cost, and the user asked specifically for an open-weight
// model from a European provider. `mistral-small-latest` with the
// *default* spelling_grammar prompt reproduced `ovhcloud/gpt-oss-20b`'s
// exact failure mode (German "also"→"Auch", a real meaning change) plus
// two more unforced synonym substitutions on the same messy-text stress
// test — worse than gpt-oss-20b, not better. Adding one sentence to the
// spelling_grammar prompt explicitly forbidding synonym substitution
// (see lib/ai-service.js's optimizeText and lib/edenai-service.js's
// optimizeTextEdenAi — kept identical on purpose) eliminated the failure
// entirely across all three test texts, with no under-correction
// regression, at roughly 1/13th of Sonnet 5's per-token cost.
//
// For context, the models ruled out before this one: EdenAI's dedicated
// text/spell_check feature (missed most German capitalization errors,
// one false positive — see the now-superseded migrate-grammar-check-to-
// edenai), `anthropic/claude-sonnet-5` (flawless but too expensive per
// the user), and `ovhcloud/gpt-oss-20b` (one real meaning-altering error
// on the stress test, not retried with the tightened prompt since a
// European open-weight model was requested instead).
//
// There is no `translation` entry: EdenAI's dedicated
// `translation/automatic_translation` feature was live-tested
// (deepl/google/amazon/microsoft/modernmt, 2026-08-28, see
// migrate-translation-to-edenai/design.md) and rejected in favor of
// routing translation through `chat` too — its input schema has no
// prompt/instruction or glossary-passthrough field at all (confirmed via
// GET /v3/info/translation/automatic_translation), which is structurally
// incompatible with this app's placeholder-masking glossary/
// do-not-translate guard (lib/translation-glossary.js), and live testing
// found real defects in every dedicated engine on a harder stress text
// (Google: a reproducible spurious code-fence artifact; ModernMT: broken
// markdown-bold syntax plus a real mistranslation; DeepL/Amazon:
// inconsistent Sie/du register within one response) that
// `chat`/`mistral-small-latest` did not have — it also correctly
// resolved one idiom ("Minutes"→"Protokoll") every dedicated engine got
// wrong. See lib/edenai-service.js's translateTextEdenAi/
// translateTextSegmentsEdenAi.
//
// transcription: 'audio/speech_to_text_async/gladia' — chosen 2026-08-30
// via a live comparison across 7 `audio/speech_to_text_async` vendors
// (openai, deepgram/nova-3, gladia, microsoft, amazon, assembly, google)
// against locally-synthesized German/English business-audio (macOS
// `say`, never real user recordings — see
// migrate-batch-transcription-to-edenai/design.md). assembly dropped
// numeric amounts entirely in German (disqualifying for a
// business-transcription tool); google returned no punctuation or
// capitalization at all in either language (unusable without heavy
// post-processing). Of the remaining five, gladia and openai tied on
// output quality (clean punctuation, correctly normalized numbers/dates,
// correct capitalization) and both beat deepgram/microsoft/amazon on
// quality; deepgram/nova-3 matched that quality tier too (only
// difference: numbers left spelled-out rather than digit-normalized) at
// roughly half gladia's per-minute price ($0.0052 vs $0.0102) with
// demonstrably working diarization (real per-word speaker entries),
// which openai's Whisper-based engine never returns at all regardless of
// price. This 3-way trade-off (cheapest: deepgram/nova-3, US; priciest
// same-quality-tier: gladia, EU) was put to the user explicitly — the
// user chose gladia and set the standing rule for every future EdenAI
// capability decision: minimize cost subject to a fixed quality bar
// *and* EU region, not cost alone. deepgram/nova-3 and openai are both
// US-only, which is why neither qualifies despite being cheaper.
//
// Follow-up round (same day): the user asked to re-verify gladia
// specifically given the punctuation quirk above. A fresh, harder
// business text (amounts, a phone number, invented names, no
// EdenAI/GhostTyper branding) came back byte-identical and fully correct
// on 3 runs against both gladia and openai — the earlier `?`-quirk did
// not reproduce on new content, so it reads as content-specific, not
// systemic. Separately, a two-speaker diarization test kept producing
// garbled text for the *second* speaker regardless of which STT engine
// processed it (gladia, openai, deepgram all failed on the same audio) —
// traced this to the synthesis source, not any provider: macOS's
// non-default `say` voices ("Reed", "Eddy") produce genuinely poor-
// quality audio, confirmed by feeding the exact same sentence that
// transcribed perfectly from "Anna" through "Eddy" instead and getting
// nonsense back from gladia. Lesson for future EdenAI audio-capability
// verification: stick to "Anna"/"Daniel"-tier default macOS voices, not
// every voice `say -v '?'` lists.
//
// There is no `ocr` entry: like `translation`, OCR has no dedicated
// EdenAI capability — it routes through `chat` too, confirmed live
// 2026-08-30 (see migrate-ocr-extraction-to-edenai/design.md).
// `mistral/mistral-small-latest` (already hardcoded for `chat`) turns
// out to be vision-capable (`input_modalities: ['text','image']` in
// EdenAI's live model catalogue) and, given the exact extraction prompt
// `lib/ai-service.js`'s `performOCR` already uses, produces markdown
// output — headings, paragraphs, and correctly-structured tables —
// indistinguishable in testing from EdenAI's own dedicated
// `ocr/ocr/mistral` engine (the same Mistral OCR product OpenRouter's
// `mistral-ocr` plugin already uses today). That dedicated feature was
// rejected anyway: it only accepts images, rejecting `application/pdf`
// outright, and the other `ocr/ocr` vendors (google/amazon/microsoft)
// return flat, unstructured text with tables collapsed into disconnected
// values — the same class of defect that ruled out dedicated MT engines
// for `translation`. PDFs need one extra step neither chat route
// requires for images: EdenAI's chat/completions has no working PDF
// content-block support (confirmed live — both a `file_data` payload and
// a `file_id` reference are rejected by Mistral's own API with "Input
// should be a valid string"), so `performOcrEdenAi` rasterizes a PDF to
// one PNG per page first (`lib/pdf-rasterize.js`, poppler-based) and
// sends all pages as one multi-image chat message — verified live
// end-to-end on a real 2-page synthetic invoice, correct output on both
// pages, no page-break artifacts.
// tts: 'audio/tts/google/gemini-2.5-flash-tts' — chosen 2026-08-30 via a
// live comparison across all 6 EdenAI TTS models with an EU region
// (amazon/standard, amazon/neural, google/wavenet, google/neural2,
// microsoft/neural, google/gemini-2.5-flash-tts); elevenlabs/deepgram/
// openai/lovoai are US-only and excluded per the standing cost/EU-region
// rule before any quality comparison, same as transcription's gladia
// decision above.
//
// Real pitfall found first: EdenAI's per-provider default voice (no
// `voice` field sent) produced garbled, partly-wrong German for nearly
// every candidate — confirmed by feeding each sample back through our
// already-verified gladia transcription and diffing against the
// original text (an intelligibility proxy, not a naturalness one — see
// below). Re-run with an explicit, known-good German voice id fixed
// this for every candidate except microsoft/neural (`de-DE-KatjaNeural`
// still corrupted a money amount, "12.500 Euro" → "12.000 aus in 500
// Euro" — a real defect on financial figures specifically, disqualifying
// regardless of price). Lesson for `synthesizeSpeechEdenAi`: never omit
// `voice` and rely on the provider default.
//
// Normalized to $/1000 characters, the EU-eligible, round-trip-correct
// field was: amazon/standard and google/wavenet tied cheapest at
// $0.004; gemini-2.5-flash-tts next at ~$0.0062 (billed per-minute,
// $0.006/min, converted using this test's own ~974 chars/min rate);
// amazon/neural and google/neural2 both $0.016. Round-trip correctness
// alone can't judge naturalness (an ASR model transcribes robotic
// "standard"-tier speech just as correctly as fluent speech), so the
// three cheapest, round-trip-correct candidates were sent to the user as
// real audio samples for an actual listening comparison — the one
// judgment this text-based test methodology cannot make. The user chose
// gemini-2.5-flash-tts (voice "Kore"): a modern LLM-based synthesis
// model, EU region, only marginally pricier than the bottom tier.
// EDENAI_TTS_DEFAULT_VOICE below is that chosen voice, used whenever an
// organization hasn't configured its own value in `ttsVoices`.
export const EDENAI_HARDCODED_MODEL = Object.freeze({
  chat: 'mistral/mistral-small-latest',
  transcription: 'audio/speech_to_text_async/gladia',
  liveTranscription: null,
  tts: 'audio/tts/google/gemini-2.5-flash-tts',
});

// Fallback voice for EdenAI TTS when an organization hasn't set its own
// `ttsVoices[EDENAI_HARDCODED_MODEL.tts]` override — see the comment
// above for how this was chosen. Unlike the model, the voice stays an
// admin-configurable free-text field (see normalizeEdenAiConfig's
// ttsVoices map) — this is only the built-in default so TTS works
// out of the box without every workspace having to configure it first.
export const EDENAI_TTS_DEFAULT_VOICE = 'Kore';

export function isEdenAiFeatureAsync(subfeature) {
  return typeof subfeature === 'string' && subfeature.endsWith('_async');
}

export function normalizeEdenAiConfig(config = {}) {
  const ttsVoices = {};
  for (const [model, voice] of Object.entries(config.ttsVoices || {})) {
    const id = normalizeModelId(model);
    const normalizedVoice = typeof voice === 'string' ? voice.trim().slice(0, 160) : '';
    if (id && normalizedVoice) ttsVoices[id] = normalizedVoice;
  }
  return {
    schemaVersion: 1,
    apiKey: typeof config.apiKey === 'string' && config.apiKey.trim() ? config.apiKey.trim() : null,
    ttsVoices,
    // Unlike OpenRouter's single all-5-capabilities-at-once activation,
    // EdenAI activates one capability at a time (see
    // pages/api/organizations/integrations/edenai/activate.js). `enabled`
    // alone is not a safe per-capability gate — once any capability is
    // activated, `enabled` becomes true for the whole integration.
    // `activatedCapabilities` is the actual gate resolveActiveProviderConfig
    // checks; it is only ever mutated by activate.js, never accepted from
    // a PUT body (see edenai.js route's pickUpdate).
    activatedCapabilities: [...new Set(
      (Array.isArray(config.activatedCapabilities) ? config.activatedCapabilities : [])
        .filter((capability) => EDENAI_CAPABILITIES.includes(capability)),
    )],
    activatedAt: config.activatedAt || null,
  };
}

export class EdenAiError extends Error {
  constructor(message, { status = 500, code = 'EDENAI_ERROR', details = null } = {}) {
    super(message);
    this.name = 'EdenAiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30_000) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
  return fetch(url, { ...options, signal });
}

export function edenAiHeaders(apiKey, extra = {}) {
  return {
    Authorization: `Bearer ${apiKey}`,
    ...extra,
  };
}

// Generic JSON POST, used by both /chat/completions and /universal-ai
// call sites in later adapters (mirrors openRouterJsonRequest's shape,
// but EdenAI has no confirmed per-request ZDR/data_collection equivalent
// to inject and no supported_parameters catalogue signal to strip
// against — see design.md's Risks section — so this stays a thin
// pass-through rather than replicating that provider-specific logic).
export async function edenAiJsonRequest(path, body, apiKey, { timeoutMs = 60_000, signal = null } = {}) {
  const response = await fetchWithTimeout(`${EDENAI_BASE_URL}${path}`, {
    method: 'POST',
    headers: edenAiHeaders(apiKey, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
    signal,
  }, timeoutMs);
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new EdenAiError(`EdenAI request failed (${response.status}).`, {
      status: response.status,
      code: response.status === 404 ? 'MODEL_UNAVAILABLE' : 'EDENAI_REQUEST_FAILED',
      details: detail.slice(0, 500),
    });
  }
  return response.json();
}

// Uploads a local file to EdenAI's persistent file store (multipart
// POST /v3/upload), returning the `file_id` used as the `file` field in
// a speech-to-text (or other file-consuming) universal-ai request —
// confirmed live 2026-08-30 against real synthesized audio (see
// migrate-batch-transcription-to-edenai/design.md). `expiresInDays: 1` is
// deliberately short: this app re-uploads per transcription chunk, it
// never needs EdenAI to retain a file beyond the single job that
// consumes it.
export async function uploadEdenAiFile(buffer, filename, apiKey, { timeoutMs = 120_000, signal = null } = {}) {
  const form = new FormData();
  form.append('file', new Blob([buffer]), filename);
  form.append('expires_in_days', '1');
  form.append('purpose', 'general');
  const response = await fetchWithTimeout(`${EDENAI_BASE_URL}/upload`, {
    method: 'POST',
    headers: edenAiHeaders(apiKey),
    body: form,
    signal,
  }, timeoutMs);
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new EdenAiError(`EdenAI file upload failed (${response.status}).`, {
      status: response.status,
      code: 'EDENAI_REQUEST_FAILED',
      details: detail.slice(0, 500),
    });
  }
  const result = await response.json();
  if (!result?.file_id) {
    throw new EdenAiError('EdenAI file upload returned no file_id.', { status: 502, code: 'EDENAI_REQUEST_FAILED' });
  }
  return result.file_id;
}

// EdenAI's async-job envelope, confirmed via edenai/cookbook's real,
// working code (voice_to_voice_agent.ipynb): `status` is
// "success"/"failed"/otherwise-pending; the launch call can return
// "success" inline for short jobs; the job id field is `public_id`, not
// `job_id` (SKILL.md's prose says `job_id` — that prose is wrong here,
// same discrepancy class as the chat endpoint path correction above).
function normalizeEdenAiJobResult(body) {
  const status = typeof body?.status === 'string' ? body.status : 'pending';
  if (status === 'success') return { status: 'success', jobId: body?.public_id || null, output: body?.output ?? null };
  if (status === 'failed') return { status: 'failed', jobId: body?.public_id || null, error: body?.error || null };
  return { status, jobId: body?.public_id || null };
}

// Launches one async job (POST /universal-ai/async). Returns immediately
// with either an inline "success" result or a "pending" job id to poll —
// this function does not loop; callers (the transcription adapters built
// in later phases) own the poll cadence/backoff via pollEdenAiAsyncJob.
export async function submitEdenAiAsyncJob(body, apiKey, { timeoutMs = 30_000, signal = null } = {}) {
  const result = await edenAiJsonRequest('/universal-ai/async', body, apiKey, { timeoutMs, signal });
  return normalizeEdenAiJobResult(result);
}

// Checks one async job's current status (GET /universal-ai/async/{id}) —
// a single check, not a poll loop.
export async function pollEdenAiAsyncJob(jobId, apiKey, { timeoutMs = 15_000, signal = null } = {}) {
  const response = await fetchWithTimeout(
    `${EDENAI_BASE_URL}/universal-ai/async/${encodeURIComponent(jobId)}`,
    { headers: edenAiHeaders(apiKey), signal },
    timeoutMs,
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new EdenAiError(`EdenAI job poll failed (${response.status}).`, {
      status: response.status,
      code: 'EDENAI_REQUEST_FAILED',
      details: detail.slice(0, 500),
    });
  }
  return normalizeEdenAiJobResult(await response.json());
}
