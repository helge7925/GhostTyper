import test from 'node:test';
import assert from 'node:assert/strict';
import { getPrompt } from '../lib/prompts.js';

test('getPrompt resolves knowledge_graph prompt in German and English', () => {
  const de = getPrompt('knowledge_graph', 'de');
  const en = getPrompt('knowledge_graph', 'en');

  assert.ok(de.includes('Wissensgraphen') || de.includes('Wissensgraph'));
  assert.ok(en.toLowerCase().includes('knowledge graph'));
});

test('getPrompt resolves mindmap prompt in German and English', () => {
  const de = getPrompt('mindmap', 'de');
  const en = getPrompt('mindmap', 'en');

  assert.ok(de.toLowerCase().includes('mindmap'));
  assert.ok(en.toLowerCase().includes('mind map'));
});
