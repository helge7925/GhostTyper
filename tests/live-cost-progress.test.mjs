import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  deriveJobProgress,
  nextProgressPollDelay,
  remainingEtaSeconds,
  shouldTrackJobProgress,
} from '../lib/job-progress.js';
import {
  buildLiveUsagePayload,
  parseLiveUsageScope,
  shouldPollLiveUsage,
  withLiveUsageBudget,
} from '../lib/live-usage.js';
import { calculateBudgetTrafficLight, resolveEffectiveBudgetLimit } from '../lib/budget-guardrails.js';

const BASE = {
  id: 12,
  created_at: '2026-06-30T10:00:00.000Z',
  updated_at: '2026-06-30T10:00:05.000Z',
  diarize: true,
  auto_analyze: true,
};

test('progress maps backend lifecycle into stable fixed steps', () => {
  const queued = deriveJobProgress({ ...BASE, status: 'queued', events: [{ id: 1, stage: 'queued', created_at: BASE.updated_at }] });
  const processing = deriveJobProgress({ ...BASE, status: 'processing', events: [{ id: 2, stage: 'processing', created_at: BASE.updated_at }] });
  const analyzing = deriveJobProgress({ ...BASE, status: 'analyzing', events: [{ id: 3, stage: 'analyzing', created_at: '2026-06-30T10:02:00Z' }] });
  const completed = deriveJobProgress({ ...BASE, status: 'completed', events: [{ id: 4, stage: 'completed', created_at: '2026-06-30T10:03:00Z' }] });
  assert.deepEqual(queued.steps.map((step) => step.key), ['upload', 'stt', 'diarization', 'analysis', 'done']);
  assert.equal(queued.activeStep, 0);
  assert.equal(processing.activeStep, 1);
  assert.equal(analyzing.activeStep, 3);
  assert.equal(completed.activeStep, 4);
  assert.equal(completed.done, true);
  assert.equal(completed.etaSeconds, 0);
  assert.ok(analyzing.etaSeconds < processing.etaSeconds);
});

test('progress preserves error, cancellation and speaker-wait states across reloads', () => {
  const error = deriveJobProgress({ ...BASE, status: 'error', events: [{ stage: 'processing', created_at: BASE.updated_at }] });
  const cancelled = deriveJobProgress({ ...BASE, status: 'cancelled', events: [{ stage: 'analyzing', created_at: BASE.updated_at }] });
  const waiting = deriveJobProgress({ ...BASE, status: 'transcribed', events: [{ stage: 'speaker_assignment', created_at: BASE.updated_at }] });
  const waitingForAnalysis = deriveJobProgress({ ...BASE, diarize: false, status: 'transcribed', events: [] });
  assert.equal(error.state, 'error');
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(waiting.state, 'waiting_for_speakers');
  assert.equal(waiting.done, false);
  assert.equal(waitingForAnalysis.state, 'waiting_for_analysis');
  assert.equal(waitingForAnalysis.done, false);
  assert.equal(shouldTrackJobProgress(waiting), false);
});

test('polling backoff is bounded and live polling stops when finished or unauthorized', () => {
  assert.deepEqual([0, 1, 2, 3, 8].map((attempt) => nextProgressPollDelay(attempt)), [3000, 6000, 12000, 15000, 15000]);
  assert.equal(shouldPollLiveUsage({ canViewCost: true, transcriptionId: 9 }), true);
  assert.equal(shouldPollLiveUsage({ canViewCost: false, transcriptionId: 9 }), false);
  assert.equal(shouldPollLiveUsage({ canViewCost: true, transcriptionId: 9, finished: true }), false);
});

test('ETA contract is total duration from the same stage start and counts down once', () => {
  assert.equal(remainingEtaSeconds({
    etaTotalSeconds: 90,
    startedAt: '2026-06-30T10:00:00Z',
    now: new Date('2026-06-30T10:00:30Z').valueOf(),
  }), 60);
  assert.equal(remainingEtaSeconds({
    etaTotalSeconds: 20,
    startedAt: '2026-06-30T10:00:00Z',
    now: new Date('2026-06-30T10:00:30Z').valueOf(),
  }), -10);
  assert.equal(remainingEtaSeconds({
    etaTotalSeconds: 20,
    startedAt: '2026-06-30T10:00:00Z',
    now: new Date('2026-06-30T10:00:50Z').valueOf(),
  }), -30);
});

test('live usage scope validation is strict and meeting aliases transcription id', () => {
  assert.deepEqual(parseLiveUsageScope({ meetingId: '42' }), { transcriptionId: 42, scope: 'meeting' });
  assert.deepEqual(parseLiveUsageScope({ transcriptionId: '7' }), { transcriptionId: 7, scope: 'transcription' });
  for (const invalid of [{}, { meetingId: '0' }, { meetingId: '7x' }, { meetingId: ['7'] }]) {
    assert.throws(() => parseLiveUsageScope(invalid));
  }
});

test('live usage aggregation exposes active, stale and finished states', () => {
  const active = buildLiveUsagePayload({
    usageRow: { total_cost: '1.25', total_requests: 3, last_usage_at: '2026-06-30T10:00:30Z' },
    transcription: { id: 4, status: 'processing' },
    now: new Date('2026-06-30T10:01:00Z'),
  });
  const stale = buildLiveUsagePayload({
    usageRow: { total_cost: '1.25', total_requests: 3, last_usage_at: '2026-06-30T10:00:00Z' },
    transcription: { id: 4, status: 'processing' },
    now: new Date('2026-06-30T10:01:00Z'),
  });
  const finished = buildLiveUsagePayload({ usageRow: {}, transcription: { id: 4, status: 'completed' } });
  assert.equal(active.state, 'active');
  assert.equal(active.totalCost, 1.25);
  assert.equal(stale.state, 'stale');
  assert.equal(finished.state, 'finished');
});

test('dashboard budget uses the most restrictive limit and stable traffic states', () => {
  const limit = resolveEffectiveBudgetLimit({ costLimit: 100, organizationCostLimit: 80 });
  assert.equal(limit, 80);
  assert.equal(calculateBudgetTrafficLight({ currentCost: 40, costLimit: limit }).level, 'green');
  assert.equal(calculateBudgetTrafficLight({ currentCost: 60, costLimit: limit }).level, 'yellow');
  assert.equal(calculateBudgetTrafficLight({ currentCost: 77, costLimit: limit }).level, 'red');
  const enriched = withLiveUsageBudget({ totalCost: 12 }, {
    limit,
    trafficLight: calculateBudgetTrafficLight({ currentCost: 12, costLimit: limit }),
  });
  assert.equal(enriched.effectiveLimit, 80);
  assert.equal(enriched.budgetTrafficLight.level, 'green');
});

test('OpenRouter TTS pricing is dynamic and actual cost is fetched by generation id', () => {
  const pricingSource = readFileSync(new URL('../lib/openrouter-pricing-core.js', import.meta.url), 'utf8');
  const ttsSource = readFileSync(new URL('../lib/tts.js', import.meta.url), 'utf8');
  assert.match(pricingSource, /capability === 'tts'/);
  assert.match(pricingSource, /pricing\.audio \?\? pricing\.completion/);
  assert.match(ttsSource, /getOpenRouterGeneration/);
  assert.doesNotMatch(ttsSource, /voxtral-mini-tts/);
});

test('all OpenRouter TTS paths reserve and commit synthesized text characters', () => {
  const paths = [
    '../lib/in-meeting-audio.js',
    '../pages/api/transcriptions/[id]/audio.js',
    '../pages/api/share/[token]/audio.js',
  ];
  for (const path of paths) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.match(source, /const chars = Array\.from\(/);
    assert.match(source, /outputQuantity: chars/);
    assert.match(source, /executeReservedSpend/);
    assert.doesNotMatch(source, /output_tokens: Math\.ceil\(seconds\)/);
  }
});

test('budget-stopped jobs expose a distinct terminal progress state', () => {
  const progress = deriveJobProgress({
    status: 'cancelled',
    budget_stop_state: 'stopped',
    created_at: '2026-07-27T10:00:00.000Z',
    updated_at: '2026-07-27T10:01:00.000Z',
    events: [],
  }, new Date('2026-07-27T10:02:00.000Z').valueOf());
  assert.equal(progress.state, 'budget_stopped');
  assert.equal(progress.done, true);
  assert.equal(progress.etaTotalSeconds, 0);
});
