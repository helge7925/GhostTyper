import {
  EDENAI_CAPABILITY_MODEL_SHAPE,
  EdenAiError,
  edenAiJsonRequest,
  isEdenAiFeatureAsync,
  submitEdenAiAsyncJob,
} from './edenai.js';

// Structured-output check, run in addition to the plain-text check below.
// `chat` now backs analyzeTranscriptionEdenAi's
// response_format:{type:'json_object'} contract (transcription analysis,
// template/table extraction — see migrate-chat-to-edenai/design.md) and
// translateTextSegmentsEdenAi's JSON-array response. OpenRouter exposes a
// `supported_parameters` catalogue signal this app checks before relying
// on JSON mode (resolveSupportedParameters); EdenAI has no confirmed
// equivalent, so this probe is the only per-model gate standing in for
// that missing signal — a model that can't honor `response_format` must
// be rejected at activation time, not discovered mid-analysis on a real
// transcription. Validates structural shape (object type, required keys,
// right value types), not an exact string match — an LLM under this
// instruction may still legitimately vary formatting details that don't
// affect JSON-mode compliance itself.
async function probeEdenAiChatStructuredOutput(apiKey, model) {
  const result = await edenAiJsonRequest('/chat/completions', {
    model,
    messages: [
      { role: 'system', content: 'Reply with only a JSON object, no other text.' },
      { role: 'user', content: 'Return a JSON object with exactly two fields: "status" (the string "ok") and "items" (a JSON array containing exactly 3 short strings).' },
    ],
    response_format: { type: 'json_object' },
  }, apiKey);
  const content = result?.choices?.[0]?.message?.content || '';
  let parsed = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = null;
  }
  const valid = parsed
    && typeof parsed === 'object'
    && !Array.isArray(parsed)
    && parsed.status === 'ok'
    && Array.isArray(parsed.items)
    && parsed.items.length === 3
    && parsed.items.every((item) => typeof item === 'string');
  if (!valid) {
    throw new EdenAiError('EdenAI chat capability probe failed: structured JSON output not honored.', {
      status: 502,
      code: 'CAPABILITY_PROBE_FAILED',
      details: { capability: 'chat', model, structuredOutput: true, response: content.slice(0, 300) },
    });
  }
}

async function probeEdenAiChat(apiKey, model) {
  const result = await edenAiJsonRequest('/chat/completions', {
    model,
    messages: [{ role: 'user', content: 'Reply with OK.' }],
  }, apiKey);
  const content = result?.choices?.[0]?.message?.content;
  if (!content || !String(content).trim()) {
    throw new EdenAiError('EdenAI chat capability probe returned an empty response.', {
      status: 502,
      code: 'CAPABILITY_PROBE_FAILED',
      details: { capability: 'chat', model },
    });
  }
  await probeEdenAiChatStructuredOutput(apiKey, model);
}

async function probeEdenAiUniversal(apiKey, capability, model, input) {
  const shape = EDENAI_CAPABILITY_MODEL_SHAPE[capability];
  if (isEdenAiFeatureAsync(shape.subfeature)) {
    const result = await submitEdenAiAsyncJob({ model, input }, apiKey);
    if (result.status === 'failed') {
      throw new EdenAiError(`EdenAI ${capability} capability probe job failed: ${result.error || 'unknown error'}.`, {
        status: 502,
        code: 'CAPABILITY_PROBE_FAILED',
        details: { capability, model, jobId: result.jobId },
      });
    }
    // A "processing"/"pending" status here is not itself a failure — this
    // is a connectivity/authorization probe, not a wait-for-completion
    // check (that belongs to the capability's real adapter, built in its
    // own migration change).
    return;
  }
  const result = await edenAiJsonRequest('/universal-ai', { model, input }, apiKey);
  // A sync-mode failure (e.g. "Provider does not support selected
  // language: de") is not an HTTP error — /universal-ai returns 200 with
  // `{status:"fail", output:null, error:{message, provider_status_code}}`
  // — confirmed live 2026-08-28 (see status.md). Surface `error.message`
  // when present so an admin sees the real reason, not a generic one.
  if (!result?.output) {
    throw new EdenAiError(
      result?.error?.message
        ? `EdenAI ${capability} capability probe failed: ${result.error.message}`
        : `EdenAI ${capability} capability probe returned no output.`,
      {
        status: 502,
        code: 'CAPABILITY_PROBE_FAILED',
        details: { capability, model },
      },
    );
  }
}

// Capability-scoped, singular — unlike probeOpenRouterDefaults (which
// probes all five OpenRouter capabilities atomically at activation
// time), this probes exactly one EdenAI capability, matching the
// per-capability (not all-or-nothing) EdenAI activation flow.
//
// Chat's probe payload is confirmed (OpenAI-compatible `messages`
// format) and built internally — now a plain-text check plus a
// structured-output (response_format:json_object) check, since chat also
// backs analysis/template-generation's JSON contract (see
// probeEdenAiChatStructuredOutput above). Every universal-ai capability
// (translation/ocr/transcription/liveTranscription/tts) requires the
// caller to supply `input` explicitly: EdenAI's exact per-feature
// `input` field shape is confirmed for some (e.g. TTS's `{text}`, STT's
// `{file, language}` — see status.md) but not all, and each is verified
// precisely by its own migration change, not guessed here.
export async function probeEdenAiCapability({ apiKey, capability, model, input } = {}) {
  if (!apiKey) throw new EdenAiError('EdenAI API key is not configured.', { status: 400, code: 'NO_API_KEY' });
  const shape = EDENAI_CAPABILITY_MODEL_SHAPE[capability];
  if (!shape) throw new EdenAiError(`Unknown EdenAI capability: ${capability}`, { status: 400, code: 'UNKNOWN_CAPABILITY' });
  if (!model) {
    throw new EdenAiError(`No model given to probe for EdenAI capability "${capability}".`, {
      status: 400,
      code: 'MODEL_UNAVAILABLE',
    });
  }
  if (shape.kind === 'chat') return probeEdenAiChat(apiKey, model);
  if (!input) {
    throw new EdenAiError(
      `EdenAI capability "${capability}" probe requires a capability-specific "input" payload.`,
      { status: 400, code: 'PROBE_INPUT_REQUIRED' },
    );
  }
  return probeEdenAiUniversal(apiKey, capability, model, input);
}
