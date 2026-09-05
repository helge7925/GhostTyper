// Behaviour tests for the transcription chunk retry policy.
//
// Long recordings are transcribed chunk by chunk and nothing reaches the
// database until the last chunk returns, so the question "is this error worth
// retrying?" decides whether hours of already-paid-for work survive a blip.
// The policy is deliberately narrow, and that narrowness is the thing worth
// pinning down: retrying an error that already produced billable output would
// charge the same audio twice.
//
// Same DATABASE_URL-guard + dynamic-import pattern as tests/edenai-ocr.test.mjs:
// lib/ai-service.js transitively imports lib/db.js, which throws on import when
// DATABASE_URL is unset. No connection is ever opened by these tests.
process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test';

import test from 'node:test';
import assert from 'node:assert/strict';

const { isRetryableTranscriptionError, withTranscriptionRetry } = await import('../lib/ai-service.js');

function httpError(status) {
  const error = new Error(`provider said ${status}`);
  error.status = status;
  return error;
}

test('retries the statuses that mean no output was produced', () => {
  for (const status of [429, 502, 503, 504]) {
    assert.equal(isRetryableTranscriptionError(httpError(status)), true, `${status} should retry`);
  }
});

test('does not retry errors that may have produced billable output', () => {
  // 500 is the important one: the provider may have done the work and failed
  // while handing it back, so a retry bills the same audio twice.
  for (const status of [400, 401, 403, 404, 413, 422, 500]) {
    assert.equal(isRetryableTranscriptionError(httpError(status)), false, `${status} should not retry`);
  }
});

test('treats a response-less failure as retryable', () => {
  // A timeout or dropped connection never returned output to bill for.
  assert.equal(isRetryableTranscriptionError(new Error('fetch failed')), true);
  assert.equal(isRetryableTranscriptionError(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), true);
});

test('never retries a cancellation', () => {
  // A budget stop or a user abort is a decision, not a failure.
  const aborted = Object.assign(new Error('Aborted'), { name: 'AbortError' });
  assert.equal(isRetryableTranscriptionError(aborted), false);
  assert.equal(isRetryableTranscriptionError(Object.assign(new Error('gone'), { code: 'MODEL_UNAVAILABLE' })), false);
});

test('succeeds on a later attempt without surfacing the transient failure', async () => {
  let calls = 0;
  const retries = [];
  const result = await withTranscriptionRetry(
    async () => {
      calls += 1;
      if (calls < 3) throw httpError(503);
      return { text: 'done' };
    },
    { onRetry: (info) => retries.push(info) },
  );

  assert.deepEqual(result, { text: 'done' });
  assert.equal(calls, 3);
  assert.equal(retries.length, 2);
  // Exponential, so a provider under load is not hammered at a fixed rate.
  assert.ok(retries[1].delayMs > retries[0].delayMs, 'backoff should grow');
});

test('gives up after the attempt limit and rethrows the provider error', async () => {
  let calls = 0;
  await assert.rejects(
    () => withTranscriptionRetry(async () => {
      calls += 1;
      throw httpError(503);
    }),
    (error) => error.status === 503,
  );
  assert.equal(calls, 3);
});

test('a non-retryable error fails on the first attempt', async () => {
  let calls = 0;
  await assert.rejects(
    () => withTranscriptionRetry(async () => {
      calls += 1;
      throw httpError(400);
    }),
    (error) => error.status === 400,
  );
  assert.equal(calls, 1, 'must not spend a second attempt on a client error');
});

test('an abort during the backoff wait stops the retry loop', async () => {
  const controller = new AbortController();
  let calls = 0;

  const pending = withTranscriptionRetry(
    async () => {
      calls += 1;
      throw httpError(503);
    },
    { signal: controller.signal },
  );

  // Abort while the first backoff is still pending.
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending);
  assert.equal(calls, 1, 'a budget stop must not be waited out and retried');
});
