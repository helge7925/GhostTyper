import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// lib/edenai-service.js now imports lib/ai-service.js (for
// transcribeAudioEdenAi's shared chunking helper), which transitively
// reaches lib/db.js via api-utils.js -> rate-limit.js -> db.js — same
// DATABASE_URL-guard + dynamic-import pattern as
// tests/edenai-pricing-gate.test.mjs and tests/settings-service.test.mjs.
process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test';
const { transcribeAudioEdenAi } = await import('../lib/edenai-service.js');
const { EDENAI_BASE_URL } = await import('../lib/edenai.js');

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// A tiny non-audio file is enough: prepareAudioForTranscription's
// ffprobe duration lookup fails gracefully on unreadable content and
// falls back to a byte-size estimate (see estimateAudioDurationSeconds
// in lib/ai-service.js) — this test exercises transcribeAudioEdenAi's
// EdenAI request/response handling, not real audio decoding.
function makeTempAudioFile() {
  const filePath = path.join(tmpdir(), `edenai-stt-test-${randomUUID()}.wav`);
  writeFileSync(filePath, Buffer.from('not real audio, just needs to exist'));
  return filePath;
}

test('transcribeAudioEdenAi uploads the chunk, submits an async job, and returns the inline-success text', async () => {
  const filePath = makeTempAudioFile();
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    const urlStr = String(url);
    calls.push(urlStr);
    if (urlStr === `${EDENAI_BASE_URL}/upload`) {
      assert.equal(options.method, 'POST');
      return response({ file_id: 'file-abc123' });
    }
    if (urlStr === `${EDENAI_BASE_URL}/universal-ai/async`) {
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'audio/speech_to_text_async/gladia');
      assert.equal(body.input.file, 'file-abc123');
      assert.equal(body.input.language, 'de');
      return response({
        status: 'success',
        public_id: 'job-xyz',
        output: { text: 'Hallo, das ist ein Test.', diarization: { total_speakers: 0, entries: [] } },
      });
    }
    throw new Error(`Unexpected fetch: ${urlStr}`);
  };
  try {
    const result = await transcribeAudioEdenAi(filePath, 'k', 'audio/speech_to_text_async/gladia', { language: 'de' });
    assert.equal(result.text, 'Hallo, das ist ein Test.');
    assert.equal(result.model, 'audio/speech_to_text_async/gladia');
    assert.equal(result.providerRequestId, 'job-xyz');
    assert.equal(result.contextBiasForwarded, false);
    assert.equal(result.segments.length, 1);
    assert.equal(result.segments[0].text, 'Hallo, das ist ein Test.');
    assert.equal(result.segments[0].precise_timestamps, false);
    assert.ok(result.usage.inputQuantity >= 1);
    assert.deepEqual(calls, [`${EDENAI_BASE_URL}/upload`, `${EDENAI_BASE_URL}/universal-ai/async`]);
  } finally {
    global.fetch = originalFetch;
    unlinkSync(filePath);
  }
});

test('transcribeAudioEdenAi polls a pending job until it succeeds', async () => {
  const filePath = makeTempAudioFile();
  const originalFetch = global.fetch;
  let pollCount = 0;
  global.fetch = async (url, options) => {
    const urlStr = String(url);
    if (urlStr === `${EDENAI_BASE_URL}/upload`) return response({ file_id: 'file-1' });
    if (urlStr === `${EDENAI_BASE_URL}/universal-ai/async`) {
      return response({ status: 'processing', public_id: 'job-poll' });
    }
    if (urlStr === `${EDENAI_BASE_URL}/universal-ai/async/job-poll`) {
      pollCount += 1;
      if (pollCount < 2) return response({ status: 'processing', public_id: 'job-poll' });
      return response({ status: 'success', public_id: 'job-poll', output: { text: 'Fertig.' } });
    }
    throw new Error(`Unexpected fetch: ${urlStr}`);
  };
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (fn) => { fn(); return 0; };
  try {
    const result = await transcribeAudioEdenAi(filePath, 'k', 'audio/speech_to_text_async/gladia', { language: 'de' });
    assert.equal(result.text, 'Fertig.');
    assert.equal(pollCount, 2);
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
    unlinkSync(filePath);
  }
});

test('transcribeAudioEdenAi throws EDENAI_REQUEST_FAILED when the job fails', async () => {
  const filePath = makeTempAudioFile();
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const urlStr = String(url);
    if (urlStr === `${EDENAI_BASE_URL}/upload`) return response({ file_id: 'file-1' });
    if (urlStr === `${EDENAI_BASE_URL}/universal-ai/async`) {
      return response({ status: 'failed', public_id: 'job-fail', error: { message: 'unsupported language' } });
    }
    throw new Error(`Unexpected fetch: ${urlStr}`);
  };
  try {
    await assert.rejects(
      transcribeAudioEdenAi(filePath, 'k', 'audio/speech_to_text_async/gladia', { language: 'xx' }),
      (error) => {
        assert.equal(error.code, 'EDENAI_REQUEST_FAILED');
        assert.match(error.message, /unsupported language/);
        return true;
      },
    );
  } finally {
    global.fetch = originalFetch;
    unlinkSync(filePath);
  }
});

test('transcribeAudioEdenAi throws MODEL_UNAVAILABLE when no model is given', async () => {
  const filePath = makeTempAudioFile();
  try {
    await assert.rejects(
      transcribeAudioEdenAi(filePath, 'k', null),
      (error) => error.code === 'MODEL_UNAVAILABLE',
    );
  } finally {
    unlinkSync(filePath);
  }
});

test('transcribeAudioEdenAi routes budget reservation through the injected executeChunk callback', async () => {
  const filePath = makeTempAudioFile();
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const urlStr = String(url);
    if (urlStr === `${EDENAI_BASE_URL}/upload`) return response({ file_id: 'file-1' });
    if (urlStr === `${EDENAI_BASE_URL}/universal-ai/async`) {
      return response({ status: 'success', public_id: 'job-1', output: { text: 'ok' } });
    }
    throw new Error(`Unexpected fetch: ${urlStr}`);
  };
  try {
    let executeChunkCalled = false;
    const result = await transcribeAudioEdenAi(filePath, 'k', 'audio/speech_to_text_async/gladia', {
      language: 'de',
      executeChunk: async ({ chunk, execute }) => {
        executeChunkCalled = true;
        assert.ok(chunk.path);
        return execute({});
      },
    });
    assert.equal(executeChunkCalled, true);
    assert.equal(result.text, 'ok');
  } finally {
    global.fetch = originalFetch;
    unlinkSync(filePath);
  }
});
