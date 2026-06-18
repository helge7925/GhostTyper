import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFollowupPrompts } from '../lib/chat-actions-utils.js';

test('buildFollowupPrompts returns bounded unique suggestions', () => {
  const prompts = buildFollowupPrompts({ content: 'Es gibt Aufgaben und Fristen.' }, { max: 3 });
  assert.equal(prompts.length, 3);
  assert.equal(new Set(prompts).size, 3);
  assert.match(prompts[0], /Aufgaben/);
});

test('buildFollowupPrompts falls back to generic suggestions', () => {
  const prompts = buildFollowupPrompts({ content: 'Kurze Antwort.' }, { max: 2 });
  assert.deepEqual(prompts, [
    'Fasse die wichtigsten Punkte als kurze Liste zusammen.',
    'Welche offenen Fragen bleiben?',
  ]);
});
