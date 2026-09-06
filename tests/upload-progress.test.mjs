// uploadAudio moved from fetch to XMLHttpRequest to get real upload progress
// and a working cancel. Everything here is about the contract the caller
// depends on, because AudioUploadForm routes on it: a rejected upload with no
// status is queued offline for a later retry, a 4xx/5xx is surfaced or queued
// depending on retryability, and a cancellation must do neither.
import test from 'node:test';
import assert from 'node:assert/strict';

class FakeXhr {
  static last = null;

  constructor() {
    this.upload = { listeners: {}, addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); } };
    this.listeners = {};
    this.status = 0;
    this.responseText = '';
    this.aborted = false;
    FakeXhr.last = this;
  }

  open(method, url) { this.method = method; this.url = url; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  send(body) { this.body = body; }
  abort() { this.aborted = true; this.emit('abort'); }
  emit(type, event) { for (const fn of this.listeners[type] || []) fn(event); }
  emitUploadProgress(loaded, total) {
    for (const fn of this.upload.listeners.progress || []) fn({ lengthComputable: true, loaded, total });
  }
  respond(status, payload) {
    this.status = status;
    this.responseText = typeof payload === 'string' ? payload : JSON.stringify(payload);
    this.emit('load');
  }
}

globalThis.XMLHttpRequest = FakeXhr;
globalThis.FormData = class { constructor() { this.entries = []; } append(k, v) { this.entries.push([k, v]); } };
globalThis.File = class {};

const { uploadAudio } = await import('../lib/api.js');

test('reports real upload progress instead of a simulated ramp', async () => {
  const seen = [];
  const pending = uploadAudio({}, { onProgress: (p) => seen.push(p) });

  FakeXhr.last.emitUploadProgress(25, 100);
  FakeXhr.last.emitUploadProgress(100, 100);
  FakeXhr.last.respond(200, { id: 7 });

  assert.deepEqual(await pending, { id: 7 });
  assert.deepEqual(seen, [25, 100]);
});

test('a server error keeps its status so the caller can decide to retry', async () => {
  const pending = uploadAudio({}, {});
  FakeXhr.last.respond(503, { message: 'Dienst nicht verfügbar' });

  await assert.rejects(pending, (error) => {
    assert.equal(error.status, 503);
    assert.equal(error.message, 'Dienst nicht verfügbar');
    return true;
  });
});

test('a transport failure rejects without a status, which means "queue it offline"', async () => {
  const pending = uploadAudio({}, {});
  FakeXhr.last.emit('error');

  await assert.rejects(pending, (error) => {
    assert.equal(error.status, undefined);
    assert.notEqual(error.name, 'AbortError');
    return true;
  });
});

test('a cancellation is an AbortError, distinguishable from a dropped connection', async () => {
  // Both reject without a status; only the name separates "the user stopped
  // this" from "the network died", and queueing a cancelled upload for a
  // silent retry later would be the wrong thing entirely.
  const controller = new AbortController();
  const pending = uploadAudio({}, { signal: controller.signal });

  controller.abort();

  await assert.rejects(pending, (error) => {
    assert.equal(error.name, 'AbortError');
    return true;
  });
  assert.equal(FakeXhr.last.aborted, true, 'the request itself must actually stop');
});

test('an already-aborted signal never opens a request', async () => {
  const controller = new AbortController();
  controller.abort();
  FakeXhr.last = null;

  await assert.rejects(
    uploadAudio({}, { signal: controller.signal }),
    (error) => error.name === 'AbortError',
  );
  assert.equal(FakeXhr.last, null, 'no request should have been created');
});

test('a non-JSON error body still yields a usable error', async () => {
  const pending = uploadAudio({}, {});
  FakeXhr.last.respond(502, '<html>gateway</html>');

  await assert.rejects(pending, (error) => {
    assert.equal(error.status, 502);
    assert.match(error.message, /502/);
    return true;
  });
});
