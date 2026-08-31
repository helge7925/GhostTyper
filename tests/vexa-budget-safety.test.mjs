import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isExplicitNonBillableProviderError } from '../lib/budget-runtime-core.js';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

async function loadElapsedHelper() {
  const body = source('../lib/vexa-bridge.js');
  const start = body.indexOf('function timestampMs');
  const end = body.indexOf('\nexport async function stopVexaForBudgetFailure', start);
  assert.ok(start >= 0 && end > start, 'elapsed helper source must remain discoverable');
  const moduleBody = `${body.slice(start, end)}\n`;
  return import(`data:text/javascript;base64,${Buffer.from(moduleBody).toString('base64')}`);
}

test('Vexa metering uses ongoing provider elapsed time across silence', async () => {
  const { vexaAudioElapsedSeconds } = await loadElapsedHelper();
  const nowMs = new Date('2026-07-27T10:01:15.000Z').getTime();
  assert.equal(vexaAudioElapsedSeconds({
    status: 'active',
    start_time: '2026-07-27T10:00:00.000Z',
    segments: [{ start: 0, end: 5, text: 'brief speech' }],
  }, { nowMs, ongoing: true }), 75);
  assert.equal(vexaAudioElapsedSeconds({
    status: 'active',
    checkpoint: { audio_elapsed_seconds: 91.2 },
    segments: [],
  }, { nowMs, ongoing: true }), 92);
});

test('Vexa explicit provider duration takes precedence over wall-clock and segment elapsed', async () => {
  const { vexaAudioElapsedSeconds } = await loadElapsedHelper();
  assert.equal(vexaAudioElapsedSeconds({
    status: 'active',
    start_time: '2026-07-27T10:00:00.000Z',
    checkpoint: { audio_elapsed_seconds: 12.1 },
    segments: [{ start: 0, end: 40, text: 'provider revised billable audio down' }],
  }, {
    nowMs: new Date('2026-07-27T12:00:00.000Z').getTime(),
    ongoing: true,
  }), 13);
  assert.equal(vexaAudioElapsedSeconds({
    status: 'active',
    start_time: '2026-07-27T10:00:00.000Z',
    audio_duration_seconds: 0,
    segments: [{ start: 0, end: 40, text: 'not billable according to provider' }],
  }, {
    nowMs: new Date('2026-07-27T12:00:00.000Z').getTime(),
    ongoing: true,
  }), 0);
});

test('Vexa final metering prefers provider end time and otherwise uses final-call wall clock', async () => {
  const { vexaAudioElapsedSeconds } = await loadElapsedHelper();
  assert.equal(vexaAudioElapsedSeconds({
    status: 'completed',
    start_time: '2026-07-27T10:00:00.000Z',
    end_time: '2026-07-27T10:01:40.000Z',
    segments: [{ start: 0, end: 40, text: 'then silence' }],
  }, { nowMs: new Date('2026-07-27T12:00:00.000Z').getTime(), ongoing: false }), 100);
  assert.equal(vexaAudioElapsedSeconds({
    status: 'completed',
    start_time: '2026-07-27T10:00:00.000Z',
    end_time: '2026-07-27T10:00:45.000Z',
    segments: [],
  }, { ongoing: false }), 45);
  assert.equal(vexaAudioElapsedSeconds({
    status: 'completed',
    start_time: '2026-07-27T10:00:00.000Z',
    segments: [{ start: 0, end: 12, text: 'last known audio' }],
  }, { nowMs: new Date('2026-07-27T12:00:00.000Z').getTime(), ongoing: false }), 7200);
});

test('final meeting checkpoint runs even when provider reports zero audio', () => {
  const body = source('../lib/vexa-bridge.js');
  assert.match(body, /if \(!final && \(!observedSeconds \|\| observedSeconds < 30\)\) return null/);
  assert.match(body, /Vexa usage checkpoint is unavailable/);
});

test('meeting start cleanup delegates definitive release versus accounting-pending retention', () => {
  const body = source('../pages/api/meetings/index.js');
  const catchStart = body.indexOf('} catch (error) {', body.indexOf('botStartAttempted = true'));
  const stop = body.indexOf('await stopBot(', catchStart);
  const handleFailure = body.indexOf('await handleReservedProviderFailure(', catchStart);
  const failed = body.indexOf("SET status = 'error', bot_status = 'failed'", catchStart);
  assert.ok(catchStart >= 0 && stop > catchStart);
  assert.ok(stop < handleFailure, 'remote stop must precede provider outcome handling');
  assert.ok(handleFailure < failed, 'provider outcome handling must precede terminal failure update');
  assert.match(body.slice(catchStart, failed), /requestTranscriptionBudgetStop/);
  assert.match(body, /await beginReservedProviderCall\(initialSttReservation\)/);
  assert.match(body.slice(catchStart, failed), /handleReservedProviderFailure\(initialSttReservation, error/);
  assert.doesNotMatch(body, /remoteStopConfirmed|releaseSpend/);
});

test('meeting start release classification excludes timeouts and uncertain provider failures', () => {
  assert.equal(isExplicitNonBillableProviderError({ response: { status: 400 } }), true);
  assert.equal(isExplicitNonBillableProviderError({ response: { status: 429 } }), true);
  assert.equal(isExplicitNonBillableProviderError({ response: { status: 408 } }), false);
  assert.equal(isExplicitNonBillableProviderError({ response: { status: 503 } }), false);
  assert.equal(isExplicitNonBillableProviderError({ code: 'ECONNABORTED' }), false);
  assert.equal(isExplicitNonBillableProviderError({ providerOutcome: 'non_billable' }), true);
});

test('meeting accounting failures request durable stop and reconciliation cannot restart them', () => {
  const bridge = source('../lib/vexa-bridge.js');
  assert.match(bridge, /DURABLE_EMERGENCY_STOP_CODES/);
  assert.match(bridge, /await requestEmergencyBudgetStop\(\{/);
  assert.match(bridge, /await requestTranscriptionBudgetStop\(\{/);
  assert.match(bridge, /await stopBot\(/);
  assert.match(bridge, /checkpointVexaMeetingSpend/);

  const reconcile = source('../pages/api/admin/vexa/reconcile.js');
  assert.match(reconcile, /status IN \('pending','processing'\) AND budget_stop_state = 'none'/);
  assert.match(reconcile, /if \(!runnable\.rowCount\) return \{ id: row\.id, action: 'budget_stopped' \}/);
  assert.match(reconcile, /startBridgeForTranscription\(row\.id, \{/);
  assert.match(reconcile, /baseUrl: integration\.config\.baseUrl/);
  assert.match(reconcile, /apiKey,/);
  assert.match(reconcile, /platform: row\.meeting_platform/);
});

test('bridge caches source-validated stop context and fails closed when DB context is lost', () => {
  const bridge = source('../lib/vexa-bridge.js');
  assert.match(bridge, /context\?\.source !== 'vexa'/);
  assert.match(bridge, /stopContext: normalizeInitialStopContext\(initialContext\)/);
  assert.match(bridge, /if \(await stopForUnavailableAccounting\(slot\)\) return;/);
  assert.match(bridge, /code: 'BUDGET_ACCOUNTING_UNAVAILABLE'/);
  assert.ok(
    bridge.indexOf('stopBridgeForTranscription(transcriptionId, `budget_failure:')
      < bridge.indexOf('await requestTranscriptionBudgetStop({'),
    'local bridge shutdown must precede durable accounting writes',
  );

  const meeting = source('../pages/api/meetings/index.js');
  assert.match(meeting, /startBridgeForTranscription\(transcription\.id, \{/);
  assert.match(meeting, /source: transcription\.source/);
  assert.match(meeting, /apiKey: userToken\.apiKey/);
});
