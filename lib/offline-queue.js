const DB_NAME = 'ghosttyper-field-mode';
const DB_VERSION = 1;
const STORE_NAME = 'pending_captures';
const QUEUE_EVENT = 'ghosttyper:offline-queue-change';
const MAX_RETRY_DELAY_MS = 5 * 60 * 1000;
export const MAX_CAPTURE_ATTEMPTS = 8;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const CAPTURE_POLICIES = Object.freeze({
  audio: Object.freeze({
    endpoint: '/api/upload',
    fields: Object.freeze(['template', 'model', 'diarize', 'customPrompt', 'analysisFocus', 'autoAnalyze']),
  }),
  ocr: Object.freeze({
    endpoint: '/api/ocr',
    fields: Object.freeze(['analyze', 'template', 'model', 'customPrompt', 'analysisFocus', 'documentScope']),
  }),
  photo_table: Object.freeze({
    endpoint: '/api/ocr',
    fields: Object.freeze(['analyze', 'template', 'model', 'customPrompt', 'analysisFocus', 'documentScope']),
  }),
});

let databasePromise = null;
const activeFlushes = new Map();
const listeners = new Set();

export class OfflineQueueError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'OfflineQueueError';
    this.code = code;
  }
}

function storageError(error) {
  if (error instanceof OfflineQueueError) return error;
  if (error?.name === 'QuotaExceededError') {
    return new OfflineQueueError('quota_exceeded', 'Offline storage is full.', error);
  }
  return new OfflineQueueError('storage_failed', 'Offline storage could not be accessed.', error);
}

export function isOfflineQueueSupported(scope = globalThis) {
  return Boolean(scope && scope.indexedDB && scope.FormData);
}

export function createCaptureId(now = Date.now(), randomUUID) {
  const uuid = randomUUID?.() || globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
    // Mix in time when a legacy browser has no Web Crypto implementation.
    const stamp = Number(now);
    for (let index = 0; index < 6; index += 1) bytes[index] ^= (stamp >> (index * 4)) & 0xff;
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function retryDelayMs(attempt) {
  const safeAttempt = Math.max(1, Number(attempt) || 1);
  return Math.min(1000 * (2 ** (safeAttempt - 1)), MAX_RETRY_DELAY_MS);
}

export function isRetryableResponse(status) {
  const value = Number(status);
  return value === 408 || value === 425 || value === 429 || value >= 500;
}

function normalizeScopeValue(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized.length > 128) {
    throw new OfflineQueueError('invalid_capture', `${name} is required.`);
  }
  return normalized;
}

function sanitizeFields(fields, policy) {
  if (!fields) return {};
  if (typeof fields !== 'object' || Array.isArray(fields)) {
    throw new OfflineQueueError('invalid_capture', 'Capture fields are invalid.');
  }
  const result = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!policy.fields.includes(key)) {
      throw new OfflineQueueError('invalid_capture', `Capture field ${key} is not allowed.`);
    }
    if (!['string', 'boolean', 'number'].includes(typeof value) || String(value).length > 100000) {
      throw new OfflineQueueError('invalid_capture', `Capture field ${key} is invalid.`);
    }
    result[key] = value;
  }
  return result;
}

function sanitizeFiles(input) {
  const files = Array.isArray(input.files)
    ? input.files
    : input.blob
      ? [{ field: 'file', blob: input.blob, name: input.filename }]
      : [];
  const blob = files[0]?.blob;
  const blobLike = blob && typeof blob.arrayBuffer === 'function' && Number.isFinite(blob.size);
  if (files.length !== 1 || (files[0]?.field && files[0].field !== 'file') || !blobLike) {
    throw new OfflineQueueError('invalid_capture', 'Capture must contain exactly one file.');
  }
  return [{
    field: 'file',
    blob: files[0].blob,
    name: String(files[0].name || input.filename || 'capture.bin').slice(0, 255),
  }];
}

export function normalizeCapture(input, options = {}) {
  const kind = input?.kind || input?.type;
  const policy = CAPTURE_POLICIES[kind];
  if (!input || !policy) {
    throw new OfflineQueueError('invalid_capture', 'Capture type is invalid.');
  }
  if (input.endpoint && input.endpoint !== policy.endpoint) {
    throw new OfflineQueueError('invalid_capture', 'Capture endpoint does not match its type.');
  }

  const now = options.now ?? Date.now();
  const id = input.id || createCaptureId(now, options.randomUUID);
  if (!UUID_V4_PATTERN.test(id)) {
    throw new OfflineQueueError('invalid_capture', 'Capture ID must be a UUID v4.');
  }
  return {
    id,
    idempotencyKey: id,
    userId: normalizeScopeValue(input.userId, 'userId'),
    organizationId: normalizeScopeValue(input.organizationId, 'organizationId'),
    kind,
    endpoint: policy.endpoint,
    method: 'POST',
    fields: sanitizeFields(input.fields, policy),
    files: sanitizeFiles(input),
    createdAt: input.createdAt || new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    status: 'pending',
    attempts: 0,
    nextAttemptAt: now,
    lastError: null,
  };
}

function openDatabase() {
  if (!globalThis.indexedDB) {
    return Promise.reject(new OfflineQueueError('unsupported', 'Offline storage is not supported.'));
  }
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    let request;
    try {
      request = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      databasePromise = null;
      reject(storageError(error));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains(STORE_NAME)
        ? request.transaction.objectStore(STORE_NAME)
        : db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      if (!store.indexNames.contains('status')) store.createIndex('status', 'status');
      if (!store.indexNames.contains('nextAttemptAt')) store.createIndex('nextAttemptAt', 'nextAttemptAt');
      if (!store.indexNames.contains('createdAt')) store.createIndex('createdAt', 'createdAt');
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => {
      databasePromise = null;
      reject(storageError(request.error));
    };
    request.onblocked = () => {
      databasePromise = null;
      reject(new OfflineQueueError('storage_blocked', 'Offline storage upgrade is blocked.'));
    };
  });
  return databasePromise;
}

async function runTransaction(mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    let result;
    try {
      result = operation(store, transaction);
    } catch (error) {
      transaction.abort();
      reject(storageError(error));
      return;
    }
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(storageError(transaction.error));
    transaction.onabort = () => reject(storageError(transaction.error));
  });
}

function emitQueueChange(detail) {
  for (const listener of listeners) listener(detail);
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent(QUEUE_EVENT, { detail }));
  }
}

export function subscribeOfflineQueue(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function enqueueCapture(input) {
  if (!isOfflineQueueSupported()) {
    throw new OfflineQueueError('unsupported', 'Offline storage is not supported.');
  }
  const capture = normalizeCapture(input);
  await runTransaction('readwrite', (store) => store.add(capture));
  emitQueueChange({ action: 'enqueued', captureId: capture.id });
  return capture;
}

function normalizeScope(scope) {
  return {
    userId: normalizeScopeValue(scope?.userId, 'userId'),
    organizationId: normalizeScopeValue(scope?.organizationId, 'organizationId'),
  };
}

export function captureScopeKey(scopeInput) {
  const scope = normalizeScope(scopeInput);
  return JSON.stringify([scope.userId, scope.organizationId]);
}

function belongsToScope(capture, scope) {
  return capture.userId === scope.userId && capture.organizationId === scope.organizationId;
}

export async function listCaptures(scopeInput) {
  const scope = normalizeScope(scopeInput);
  return runTransaction('readonly', (store) => new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result
      .filter((capture) => belongsToScope(capture, scope))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    request.onerror = () => reject(storageError(request.error));
  }));
}

export async function countCaptures(scope) {
  if (!isOfflineQueueSupported()) return 0;
  return (await listCaptures(scope)).length;
}

export async function getOfflineQueueSummary(scope) {
  if (!isOfflineQueueSupported()) return { supported: false, pending: 0, failed: 0, syncing: 0, lastError: null };
  const captures = await listCaptures(scope);
  return captures.reduce((summary, capture) => {
    if (capture.status === 'failed' || capture.status === 'blocked') summary.failed += 1;
    else if (capture.status === 'syncing') summary.syncing += 1;
    else summary.pending += 1;
    if (capture.lastError) summary.lastError = String(capture.lastError).slice(0, 160);
    return summary;
  }, { supported: true, pending: 0, failed: 0, syncing: 0, lastError: null });
}

function appendFormValue(form, key, value) {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    for (const item of value) appendFormValue(form, key, item);
    return;
  }
  form.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
}

export function captureToFormData(capture, FormDataClass = globalThis.FormData) {
  const form = new FormDataClass();
  for (const [key, value] of Object.entries(capture.fields || {})) appendFormValue(form, key, value);
  for (const file of capture.files || []) {
    if (!file?.blob) continue;
    form.append(file.field || 'file', file.blob, file.name || 'capture.bin');
  }
  form.append('clientCaptureId', capture.idempotencyKey);
  form.append('clientCaptureUserId', capture.userId);
  form.append('clientCaptureOrganizationId', capture.organizationId);
  return form;
}

async function updateCapture(capture) {
  await runTransaction('readwrite', (store) => store.put(capture));
}

async function deleteCaptureUnsafe(id) {
  await runTransaction('readwrite', (store) => store.delete(id));
}

export async function removeCapture(id, scopeInput) {
  const scope = normalizeScope(scopeInput);
  return runTransaction('readwrite', (store) => new Promise((resolve, reject) => {
    const getRequest = store.get(id);
    getRequest.onerror = () => reject(storageError(getRequest.error));
    getRequest.onsuccess = () => {
      if (!getRequest.result || !belongsToScope(getRequest.result, scope)) {
        resolve(false);
        return;
      }
      const deleteRequest = store.delete(id);
      deleteRequest.onerror = () => reject(storageError(deleteRequest.error));
      deleteRequest.onsuccess = () => resolve(true);
    };
  })).then((removed) => {
    if (removed) emitQueueChange({ action: 'removed', captureId: id });
    return removed;
  });
}

function responseDisposition(status) {
  if (status === 401 || status === 403) return 'blocked';
  return isRetryableResponse(status) ? 'retry' : 'failed';
}

export function captureDisposition(status, attempts) {
  const disposition = responseDisposition(status);
  return disposition === 'retry' && Number(attempts) >= MAX_CAPTURE_ATTEMPTS
    ? 'failed'
    : disposition;
}

async function parseResponseBody(response) {
  if (typeof response?.json !== 'function') return {};
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export async function uploadQueuedCapture(capture, fetchImpl = globalThis.fetch) {
  // IndexedDB is client-controlled. Re-apply all allowlists before turning a
  // persisted record into a network request.
  const safeCapture = normalizeCapture(capture, { now: Date.now() });
  const uploadResponse = await fetchImpl(safeCapture.endpoint, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-Idempotency-Key': safeCapture.idempotencyKey },
    body: captureToFormData(safeCapture),
  });
  if (!uploadResponse.ok) {
    return { ok: false, status: uploadResponse.status, stage: 'upload' };
  }
  if (safeCapture.kind !== 'audio') {
    return { ok: true, status: uploadResponse.status, stage: 'upload' };
  }

  const payload = await parseResponseBody(uploadResponse);
  const transcriptionId = Number(payload.id);
  if (!Number.isSafeInteger(transcriptionId) || transcriptionId <= 0) {
    throw new OfflineQueueError('invalid_response', 'Upload response did not include a transcription ID.');
  }
  const processResponse = await fetchImpl(`/api/transcriptions/${transcriptionId}/process`, {
    method: 'POST',
    credentials: 'same-origin',
  });
  return {
    ok: processResponse.ok,
    status: processResponse.status,
    stage: 'process',
    transcriptionId,
  };
}

async function flushInternal({
  userId,
  organizationId,
  fetchImpl = globalThis.fetch,
  now = Date.now(),
  manual = false,
} = {}) {
  if (!isOfflineQueueSupported() || typeof fetchImpl !== 'function') {
    throw new OfflineQueueError('unsupported', 'Offline synchronization is not supported.');
  }

  const scope = normalizeScope({ userId, organizationId });
  const captures = await listCaptures(scope);
  const due = captures.filter((capture) => {
    if (capture.status === 'failed') return manual;
    if (capture.status === 'blocked') return manual;
    return manual || capture.nextAttemptAt <= now;
  });
  const result = { synced: 0, retried: 0, failed: 0, remaining: captures.length };

  for (const original of due) {
    const capture = {
      ...original,
      status: 'syncing',
      attempts: original.attempts + 1,
      updatedAt: new Date(now).toISOString(),
    };
    await updateCapture(capture);
    emitQueueChange({ action: 'syncing', captureId: capture.id });

    try {
      const syncResult = await uploadQueuedCapture(capture, fetchImpl);
      if (syncResult.ok) {
        await deleteCaptureUnsafe(capture.id);
        result.synced += 1;
        result.remaining -= 1;
        emitQueueChange({ action: 'synced', captureId: capture.id });
        continue;
      }
      const disposition = captureDisposition(syncResult.status, capture.attempts);
      capture.status = disposition;
      capture.lastError = `${syncResult.stage === 'process' ? 'Processing ' : ''}HTTP ${syncResult.status}`;
      capture.nextAttemptAt = disposition === 'retry' ? now + retryDelayMs(capture.attempts) : null;
      await updateCapture(capture);
      result[disposition === 'retry' ? 'retried' : 'failed'] += 1;
      emitQueueChange({ action: capture.status, captureId: capture.id });
    } catch (error) {
      const retryable = (error instanceof TypeError || error?.name === 'NetworkError')
        && capture.attempts < MAX_CAPTURE_ATTEMPTS;
      capture.status = retryable ? 'retry' : 'failed';
      capture.lastError = error?.message || 'Network error';
      capture.nextAttemptAt = retryable ? now + retryDelayMs(capture.attempts) : null;
      await updateCapture(capture);
      result[retryable ? 'retried' : 'failed'] += 1;
      emitQueueChange({ action: capture.status, captureId: capture.id });
    }
  }
  return result;
}

export function flushOfflineQueue(options) {
  const scope = normalizeScope(options);
  const scopeKey = captureScopeKey(scope);
  if (activeFlushes.has(scopeKey)) return activeFlushes.get(scopeKey);
  const flush = flushInternal({ ...options, ...scope }).finally(() => {
    activeFlushes.delete(scopeKey);
  });
  activeFlushes.set(scopeKey, flush);
  return flush;
}
