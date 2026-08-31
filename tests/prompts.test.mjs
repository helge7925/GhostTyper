import test from 'node:test';
import assert from 'node:assert/strict';
import { getPrompt, TEMPLATE_GENERATOR_PROMPT } from '../lib/prompts.js';

test('getPrompt resolves data_table prompt in German and English', () => {
  const de = getPrompt('data_table', 'de');
  const en = getPrompt('data_table', 'en');

  assert.ok(de.includes('Datentabelle'));
  assert.ok(en.toLowerCase().includes('data table'));
});

// Regression guard for a real defect found live 2026-08-30 (see
// migrate-chat-to-edenai/design.md): without this clarifying sentence,
// EdenAI's hardcoded chat model (mistral/mistral-small-latest)
// consistently wrapped its ENTIRE response in a ```json code fence
// (or returned a bare JSON object) instead of the natural-language
// instruction text generateTemplate/generateTemplateEdenAi's callers
// require — confirmed reproducible across 3 different goals, fixed by
// this one sentence, re-verified live afterwards. Shared between both
// providers on purpose (same ambiguity could affect any model).
test('TEMPLATE_GENERATOR_PROMPT explicitly tells the model its own response must be plain text, not JSON', () => {
  assert.match(TEMPLATE_GENERATOR_PROMPT, /Deine eigene Antwort .* ist selbst reiner Fließtext, KEIN JSON/);
});
