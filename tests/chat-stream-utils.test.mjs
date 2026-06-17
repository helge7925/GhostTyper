import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCortecsBody, parseChatStreamLine } from '../lib/chat-stream-utils.js';

test('buildCortecsBody omits stream fields by default', () => {
  const body = buildCortecsBody({ chatModel: 'deepseek-v4-pro' }, [{ role: 'user', content: 'hi' }]);
  assert.equal(body.model, 'deepseek-v4-pro');
  assert.equal(body.temperature, 0.7);
  assert.equal(body.stream, undefined);
  assert.equal(body.stream_options, undefined);
});

test('buildCortecsBody adds streaming + usage flags and preference', () => {
  const body = buildCortecsBody(
    { chatModel: 'm', preference: 'balanced' },
    [{ role: 'user', content: 'hi' }],
    { stream: true },
  );
  assert.equal(body.stream, true);
  assert.deepEqual(body.stream_options, { include_usage: true });
  assert.equal(body.preference, 'balanced');
});

test('parseChatStreamLine extracts the content delta', () => {
  const line = 'data: {"choices":[{"delta":{"content":"Hello"}}]}';
  assert.deepEqual(parseChatStreamLine(line), {
    contentDelta: 'Hello',
    finishReason: null,
    usage: null,
  });
});

test('parseChatStreamLine captures finish_reason and usage', () => {
  const line = 'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":8}}';
  const parsed = parseChatStreamLine(line);
  assert.equal(parsed.contentDelta, '');
  assert.equal(parsed.finishReason, 'stop');
  assert.deepEqual(parsed.usage, { prompt_tokens: 12, completion_tokens: 8 });
});

test('parseChatStreamLine recognises the [DONE] terminator', () => {
  assert.deepEqual(parseChatStreamLine('data: [DONE]'), { done: true });
});

test('parseChatStreamLine ignores non-data, blank and malformed lines', () => {
  assert.equal(parseChatStreamLine(''), null);
  assert.equal(parseChatStreamLine(': keep-alive comment'), null);
  assert.equal(parseChatStreamLine('event: delta'), null);
  assert.equal(parseChatStreamLine('data: not-json'), null);
  assert.equal(parseChatStreamLine('data:'), null);
});
