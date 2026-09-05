// Direct-Mistral workload adapters, mirroring lib/edenai-service.js's
// role for EdenAI. Grows one export per direct-Mistral consumer:
// translateTextSegmentsMistral, for live in-meeting translation.
//
// Live-meeting speech-to-text, the other direct-Mistral consumer, has no
// adapter here on purpose — it runs inside the Python bridge
// (services/voxtral-bridge/main.py), not this Node process, because it
// needs Mistral's realtime WebSocket protocol rather than a REST call.
//
// Each function returns exactly the shape its lib/edenai-service.js and
// lib/ai-service.js counterparts return, so call sites only change which
// function they import, not how they use the result.

import { mistralJsonRequest } from './mistral.js';

// Kept byte-for-byte identical to lib/ai-service.js's and
// lib/edenai-service.js's STRICT_PLACEHOLDER_INSTRUCTION so the glossary
// guard (lib/translation-glossary.js) behaves identically regardless of
// provider. tests/translation-prompt-parity.test.mjs asserts all three
// providers really do build the same prompt, so this duplication can't
// silently drift.
const STRICT_PLACEHOLDER_INSTRUCTION = 'CRITICAL: The text contains placeholder tokens such as DNTX0X…XTDN and TRMX0X…XMRT. Copy every placeholder into your output verbatim — identical characters, no inserted spaces, never translated, altered, or removed. A dropped placeholder makes the whole result unusable.';

// Mirrors lib/edenai-service.js's translateTextSegmentsEdenAi exactly —
// same strict-JSON-array contract, same prompt, same return shape, same
// SEGMENT_TRANSLATION_SHAPE_MISMATCH error carrying provider usage so the
// caller can still bill a failed-but-charged call. Only the transport
// differs (api.mistral.ai directly instead of EdenAI's aggregation layer).
//
// Used by lib/vexa-bridge.js's runTranslationDelta for live in-meeting
// translation, where the EdenAI hop's added latency is visible to the
// audience as subtitle lag. Batch/inline translation
// (pages/api/translate.js, pages/api/translate/file.js) deliberately does
// NOT use this — those are not latency-sensitive, and routing them here
// would fragment provider selection for no benefit.
export async function translateTextSegmentsMistral(segments, targetLanguage, sourceLanguage = 'auto', apiKey, model, options = {}) {
  if (!model) throw Object.assign(new Error('MODEL_UNAVAILABLE'), { code: 'MODEL_UNAVAILABLE' });
  const glossaryBlock = String(options?.glossaryBlock || '').trim();
  const safeSegments = Array.isArray(segments) ? segments.map((entry) => String(entry ?? '')) : [];
  if (safeSegments.length === 0) {
    return { translations: [], usage: {}, model };
  }

  const strictBlock = options?.strictPlaceholders ? `\n\n${STRICT_PLACEHOLDER_INSTRUCTION}` : '';
  const systemPrompt = `You are a professional translator for office documents.
Translate every segment into ${targetLanguage}.
${sourceLanguage !== 'auto' ? `The source language is ${sourceLanguage}.` : 'Detect the source language automatically.'}
Return strict JSON with exactly this shape: {"translations":["..."]}.
Rules:
- The translations array must have exactly the same length and order as the input segments.
- Translate only the text content.
- Do not add explanations, numbering, markdown, XML, or extra fields.
- Preserve short placeholders, product names, numbers, and punctuation when appropriate.${glossaryBlock ? `\n\n${glossaryBlock}` : ''}${strictBlock}`;

  const result = await mistralJsonRequest('/chat/completions', {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify({ segments: safeSegments }) },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
  }, apiKey, options);

  const content = result.choices?.[0]?.message?.content || '{}';
  let parsed = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = null;
  }

  const translations = Array.isArray(parsed?.translations)
    ? parsed.translations.map((entry) => String(entry ?? ''))
    : null;

  if (!translations || translations.length !== safeSegments.length) {
    const error = new Error('SEGMENT_TRANSLATION_SHAPE_MISMATCH');
    error.providerUsage = result.usage || {};
    error.providerModel = result.model || model;
    error.providerRequestId = result.id || null;
    throw error;
  }

  return {
    translations,
    usage: result.usage || {},
    model: result.model || model,
    providerRequestId: result.id || null,
  };
}
