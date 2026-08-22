import crypto from 'crypto';

async function fetchWithTimeout(url, options = {}, timeoutMs = 30_000) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
  return fetch(url, { ...options, signal });
}

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const OPENROUTER_CAPABILITIES = Object.freeze([
  'chat',
  'ocr',
  'transcription',
  'liveTranscription',
  'tts',
]);

const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/~-]{0,254}$/;
const FRESH_MS = 10 * 60 * 1000;
const STALE_MS = 24 * 60 * 60 * 1000;
const catalogueCache = new Map();

export class OpenRouterError extends Error {
  constructor(message, { status = 500, code = 'OPENROUTER_ERROR', details = null } = {}) {
    super(message);
    this.name = 'OpenRouterError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function normalizeModelId(value) {
  if (typeof value !== 'string') return null;
  const model = value.trim();
  return MODEL_ID_PATTERN.test(model) ? model : null;
}

export function emptyModelMap() {
  return Object.fromEntries(OPENROUTER_CAPABILITIES.map((capability) => [capability, []]));
}

export function emptyDefaultMap() {
  return Object.fromEntries(OPENROUTER_CAPABILITIES.map((capability) => [capability, '']));
}

export function normalizeOpenRouterConfig(config = {}) {
  const allowedModels = emptyModelMap();
  const defaultModels = emptyDefaultMap();
  for (const capability of OPENROUTER_CAPABILITIES) {
    const input = Array.isArray(config.allowedModels?.[capability])
      ? config.allowedModels[capability]
      : [];
    allowedModels[capability] = [...new Set(input.map(normalizeModelId).filter(Boolean))];
    defaultModels[capability] = normalizeModelId(config.defaultModels?.[capability]) || '';
  }
  const ttsVoices = {};
  for (const [model, voice] of Object.entries(config.ttsVoices || {})) {
    const id = normalizeModelId(model);
    const normalizedVoice = typeof voice === 'string' ? voice.trim().slice(0, 160) : '';
    if (id && normalizedVoice) ttsVoices[id] = normalizedVoice;
  }
  return {
    schemaVersion: 1,
    apiKey: typeof config.apiKey === 'string' && config.apiKey.trim() ? config.apiKey.trim() : null,
    allowedModels,
    defaultModels,
    ttsVoices,
    liveTranscriptionVerified: [...new Set(
      (Array.isArray(config.liveTranscriptionVerified) ? config.liveTranscriptionVerified : [])
        .map(normalizeModelId).filter(Boolean),
    )],
    activatedAt: config.activatedAt || null,
  };
}

export function validateGovernanceConfig(config) {
  const normalized = normalizeOpenRouterConfig(config);
  const invalid = [];
  for (const capability of OPENROUTER_CAPABILITIES) {
    const selected = normalized.defaultModels[capability];
    if (selected && !normalized.allowedModels[capability].includes(selected)) {
      invalid.push(`defaultModels.${capability}`);
    }
  }
  return { normalized, invalid };
}

function appHeaders(apiKey, extra = {}) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'HTTP-Referer': process.env.APP_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000',
    'X-OpenRouter-Title': 'GhostTyper',
    ...extra,
  };
}

function keyFingerprint(apiKey, organizationId) {
  return `${organizationId || 'operator'}:${crypto.createHash('sha256').update(String(apiKey)).digest('hex').slice(0, 16)}`;
}

function normalizeModel(raw) {
  const id = normalizeModelId(raw?.id);
  if (!id) return null;
  const input = Array.isArray(raw?.architecture?.input_modalities) ? raw.architecture.input_modalities : [];
  const output = Array.isArray(raw?.architecture?.output_modalities) ? raw.architecture.output_modalities : [];
  const expiresAt = raw.expiration_date ? new Date(raw.expiration_date) : null;
  return {
    id,
    name: String(raw.name || id),
    description: String(raw.description || ''),
    inputModalities: input,
    outputModalities: output,
    supportedParameters: Array.isArray(raw.supported_parameters) ? raw.supported_parameters : [],
    supportedVoices: Array.isArray(raw.supported_voices) ? raw.supported_voices : [],
    pricing: raw.pricing && typeof raw.pricing === 'object' ? raw.pricing : {},
    expirationDate: raw.expiration_date || null,
    available: !expiresAt || Number.isNaN(expiresAt.valueOf()) || expiresAt.valueOf() > Date.now(),
    contextLength: Number(raw.context_length || 0),
  };
}

export function modelSupportsCapability(model, capability) {
  const input = new Set(model?.inputModalities || []);
  const output = new Set(model?.outputModalities || []);
  if (capability === 'chat') return input.has('text') && output.has('text');
  if (capability === 'ocr') return input.has('image') && output.has('text');
  if (capability === 'transcription') return input.has('audio') && output.has('text');
  if (capability === 'liveTranscription') {
    return input.has('audio') && output.has('text') && (model?.supportedParameters || []).includes('response_format');
  }
  if (capability === 'tts') return input.has('text') && output.has('audio');
  return false;
}

async function fetchModels(url, apiKey) {
  const response = await fetchWithTimeout(url, { headers: appHeaders(apiKey) }, 12_000);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new OpenRouterError(`OpenRouter model catalogue failed (${response.status}).`, {
      status: response.status,
      code: 'OPENROUTER_CATALOGUE_FAILED',
      details: body.slice(0, 240),
    });
  }
  const body = await response.json();
  return Array.isArray(body?.data) ? body.data : [];
}

export async function getOpenRouterCatalogue({ apiKey, organizationId, allowStale = true, force = false, sort = null }) {
  if (!apiKey) throw new OpenRouterError('OpenRouter API key is not configured.', { status: 400, code: 'NO_API_KEY' });
  const safeSort = ['pricing-low-to-high', 'latency-low-to-high', 'intelligence-high-to-low', 'most-popular'].includes(sort) ? sort : null;
  const cacheKey = `${keyFingerprint(apiKey, organizationId)}:${safeSort || 'default'}`;
  const cached = catalogueCache.get(cacheKey);
  const now = Date.now();
  if (!force && cached && now - cached.fetchedAt < FRESH_MS) return { ...cached, stale: false };
  try {
    const sortQuery = safeSort ? `&sort=${encodeURIComponent(safeSort)}` : '';
    const [userModels, zdrModels] = await Promise.all([
      fetchModels(`${OPENROUTER_BASE_URL}/models/user?output_modalities=all${sortQuery}`, apiKey),
      fetchModels(`${OPENROUTER_BASE_URL}/models?output_modalities=all&zdr=true${sortQuery}`, apiKey),
    ]);
    const zdrIds = new Set(zdrModels.map((model) => model?.id).filter(Boolean));
    const models = userModels.map(normalizeModel).filter((model) => model && zdrIds.has(model.id));
    const entry = { models, fetchedAt: now };
    catalogueCache.set(cacheKey, entry);
    return { ...entry, stale: false };
  } catch (error) {
    if (allowStale && cached && now - cached.fetchedAt < STALE_MS) return { ...cached, stale: true };
    throw error;
  }
}

export function modelsForCapability(models, capability) {
  if (!OPENROUTER_CAPABILITIES.includes(capability)) return [];
  return (models || []).filter((model) => model.available !== false && modelSupportsCapability(model, capability));
}

export function resolveConfiguredModel(config, capability, requestedModel = null) {
  const normalized = normalizeOpenRouterConfig(config);
  const requested = normalizeModelId(requestedModel);
  if (requested && normalized.allowedModels[capability]?.includes(requested)) return requested;
  const fallback = normalized.defaultModels[capability];
  if (fallback && normalized.allowedModels[capability]?.includes(fallback)) return fallback;
  throw new OpenRouterError(`No available ${capability} model is configured.`, {
    status: 409,
    code: 'MODEL_UNAVAILABLE',
  });
}

export async function openRouterJsonRequest(path, body, apiKey, {
  timeoutMs = 60_000,
  signal = null,
  supportedParameters = [],
} = {}) {
  const payload = {
    ...body,
    provider: {
      ...(body?.provider || {}),
      zdr: true,
      data_collection: 'deny',
    },
  };
  if (path === '/chat/completions') {
    payload.usage = { ...(body?.usage || {}), include: true };
  }
  const supported = new Set(supportedParameters || []);
  for (const parameter of ['temperature', 'response_format', 'stream']) {
    if (Object.prototype.hasOwnProperty.call(payload, parameter) && !supported.has(parameter)) {
      delete payload[parameter];
    }
  }
  const response = await fetchWithTimeout(`${OPENROUTER_BASE_URL}${path}`, {
    method: 'POST',
    headers: appHeaders(apiKey, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
    signal,
  }, timeoutMs);
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const unavailable = response.status === 404 || /model.{0,40}(unavailable|not found|no endpoints)/i.test(detail);
    throw new OpenRouterError(`OpenRouter request failed (${response.status}).`, {
      status: response.status,
      code: unavailable ? 'MODEL_UNAVAILABLE' : 'OPENROUTER_REQUEST_FAILED',
      details: detail.slice(0, 500),
    });
  }
  return response.json();
}

export function openRouterHeaders(apiKey, extra = {}) {
  return appHeaders(apiKey, extra);
}

export async function getOpenRouterGeneration(apiKey, generationId, { attempts = 4 } = {}) {
  if (!generationId) return null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      // Generation accounting can materialize shortly after an audio response.
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
    // eslint-disable-next-line no-await-in-loop
    const response = await fetchWithTimeout(
      `${OPENROUTER_BASE_URL}/generation?id=${encodeURIComponent(generationId)}`,
      { headers: appHeaders(apiKey) },
      8_000,
    );
    if (response.ok) return (await response.json())?.data || null;
    if (response.status !== 404) break;
  }
  return null;
}
