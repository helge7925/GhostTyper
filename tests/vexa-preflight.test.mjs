import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const meetings = readFileSync(new URL('../pages/api/meetings/index.js', import.meta.url), 'utf8');
const vexa = readFileSync(new URL('../lib/api/vexa.js', import.meta.url), 'utf8');

test('meeting start performs an authenticated Vexa preflight before creating work', () => {
  const preflight = meetings.indexOf('await adminHealthCheck({');
  const insert = meetings.indexOf('INSERT INTO transcriptions');
  const botStart = meetings.indexOf('botResponse = await startBot(');

  assert.ok(preflight >= 0);
  assert.ok(preflight < insert);
  assert.ok(preflight < botStart);
  assert.match(meetings, /status\(503\)\.json\(\{[\s\S]*?code: 'VEXA_UNAVAILABLE'/);
});

test('Vexa health check combines a bodyless status probe with admin-token validation', () => {
  assert.match(vexa, /axios\.head\(probeUrl/);
  assert.match(vexa, /'X-Admin-API-Key': adminToken/);
  assert.match(vexa, /client\.get\('\/admin\/users\?limit=1'\)/);
  assert.match(vexa, /maxRedirects: 0/);
});
