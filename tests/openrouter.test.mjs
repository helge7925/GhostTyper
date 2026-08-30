import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  getOpenRouterCatalogue,
  modelSupportsCapability,
  normalizeModelId,
  normalizeOpenRouterConfig,
  openRouterJsonRequest,
  resolveConfiguredModel,
  validateGovernanceConfig,
} from '../lib/openrouter.js';
import { normalizeCataloguePrice } from '../lib/openrouter-pricing-core.js';

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('model ids are dynamic but bounded to 255 safe characters', () => {
  assert.equal(normalizeModelId('vendor/family:model~variant'), 'vendor/family:model~variant');
  assert.equal(normalizeModelId(`v/${'x'.repeat(253)}`), 'v/' + 'x'.repeat(253));
  assert.equal(normalizeModelId(`v/${'x'.repeat(254)}`), null);
  assert.equal(normalizeModelId('bad model'), null);
});

test('governance requires every configured default to be allowlisted', () => {
  const config = normalizeOpenRouterConfig({
    allowedModels: { chat: ['vendor/chat'] },
    defaultModels: { chat: 'vendor/other' },
  });
  assert.deepEqual(validateGovernanceConfig(config).invalid, ['defaultModels.chat']);
  config.defaultModels.chat = 'vendor/chat';
  assert.equal(resolveConfiguredModel(config, 'chat', 'vendor/not-allowed'), 'vendor/chat');
});

test('capability filters use OpenRouter modalities and live response-format support', () => {
  const stt = { inputModalities: ['audio'], outputModalities: ['text'], supportedParameters: [] };
  assert.equal(modelSupportsCapability(stt, 'transcription'), true);
  assert.equal(modelSupportsCapability(stt, 'liveTranscription'), false);
  assert.equal(modelSupportsCapability({ ...stt, supportedParameters: ['response_format'] }, 'liveTranscription'), true);
  assert.equal(modelSupportsCapability({ inputModalities: ['text'], outputModalities: ['audio'] }, 'tts'), true);
});

test('catalogue intersects user-visible and ZDR model sets and can return stale UI data', async () => {
  const originalFetch = global.fetch;
  const model = {
    id: 'vendor/chat-model', name: 'Chat',
    architecture: { input_modalities: ['text'], output_modalities: ['text'] },
    supported_parameters: ['temperature'], pricing: { prompt: '0.000001', completion: '0.000002' },
  };
  global.fetch = async (url) => response({ data: String(url).includes('/models/user') ? [model, { ...model, id: 'vendor/not-zdr' }] : [model] });
  try {
    const fresh = await getOpenRouterCatalogue({ apiKey: 'catalog-test-key', organizationId: 991, force: true });
    assert.deepEqual(fresh.models.map((entry) => entry.id), ['vendor/chat-model']);
    global.fetch = async () => { throw new Error('offline'); };
    const stale = await getOpenRouterCatalogue({ apiKey: 'catalog-test-key', organizationId: 991, force: true, allowStale: true });
    assert.equal(stale.stale, true);
    assert.equal(stale.models[0].id, 'vendor/chat-model');
  } finally {
    global.fetch = originalFetch;
  }
});

test('every JSON workload enforces ZDR and denies data collection', async () => {
  const originalFetch = global.fetch;
  let captured = null;
  global.fetch = async (_url, options) => {
    captured = JSON.parse(options.body);
    return response({ choices: [{ message: { content: 'ok' } }] });
  };
  try {
    await openRouterJsonRequest('/chat/completions', {
      model: 'vendor/chat-model', messages: [], provider: { zdr: false, data_collection: 'allow' },
    }, 'request-test-key');
    assert.deepEqual(captured.provider, { zdr: true, data_collection: 'deny' });
  } finally {
    global.fetch = originalFetch;
  }
});

test('catalogue prices normalize dynamically without model ids', () => {
  assert.deepEqual(normalizeCataloguePrice({ pricing: { prompt: '0.000001', completion: '0.000004' } }, 'chat'), {
    inputUnit: 'token', outputUnit: 'token', inputRate: 1_000_000, outputRate: 4_000_000,
  });
});

test('the main OpenRouter-facing app sources contain no fixed model ids or legacy inference hosts', () => {
  // Scoped to the actual OpenRouter call sites — NOT
  // services/voxtral-bridge/main.py or config/docker-compose.prod.yml
  // any more. Those two now deliberately call Mistral direct
  // (voxtral-mini-transcribe-realtime-2602, api.mistral.ai) for
  // live-meeting STT specifically — see
  // migrate-live-meeting-stt-to-edenai/design.md for why: EdenAI's
  // async job model and OpenRouter's own gateway were both measured too
  // slow for a live meeting's chunk cadence, so this one capability
  // bypasses both. See the next test for what's still guarded in those
  // two files.
  const files = [
    '../lib/ai-service.js', '../lib/openrouter.js', '../lib/tts.js',
    '../lib/transcription-worker.js',
  ];
  const source = files.map((file) => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');
  assert.doesNotMatch(source, /api\.(?:cortecs|mistral)\.ai/);
  assert.doesNotMatch(source, /deepseek-v4|whisper-large-v3|voxtral-mini|mistral-ocr-latest/);
});

test('the voxtral bridge and its compose config only reference the current realtime model, no legacy ones', () => {
  const files = ['../services/voxtral-bridge/main.py', '../config/docker-compose.prod.yml'];
  const source = files.map((file) => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');
  // Cortecs stays fully removed everywhere, including here.
  assert.doesNotMatch(source, /api\.cortecs\.ai/);
  // Legacy/wrong model ids that were never correct for this bridge.
  assert.doesNotMatch(source, /deepseek-v4|whisper-large-v3|mistral-ocr-latest/);
  // The one model this bridge is allowed to reference is the exact
  // realtime transcription model, not some other voxtral-mini variant
  // (e.g. a batch/async one, which would silently break the bridge's
  // synchronous per-chunk contract).
  const voxtralMentions = source.match(/voxtral-mini[\w-]*/g) || [];
  for (const mention of voxtralMentions) {
    assert.equal(mention, 'voxtral-mini-transcribe-realtime-2602', mention);
  }
  assert.match(source, /api\.mistral\.ai|MISTRAL_API_KEY/);
});
