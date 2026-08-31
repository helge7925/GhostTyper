export const JOB_PROGRESS_STEPS = Object.freeze([
  { key: 'upload' },
  { key: 'stt' },
  { key: 'diarization' },
  { key: 'analysis' },
  { key: 'done' },
]);

const BASE_STEP_SECONDS = Object.freeze({
  upload: 5,
  stt: 90,
  diarization: 30,
  analysis: 45,
  done: 0,
});

const TERMINAL_STATUSES = new Set(['completed', 'transcribed', 'error', 'cancelled', 'canceled']);

function timestamp(value, fallback = null) {
  const parsed = new Date(value).valueOf();
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stageStep(stage) {
  const normalized = String(stage || '').toLowerCase();
  if (['completed', 'done', 'finished'].includes(normalized)) return 4;
  if (['analyzing', 'analysis'].includes(normalized)) return 3;
  if (['speaker_assignment', 'diarization', 'diarisation'].includes(normalized)) return 2;
  if (['processing', 'transcribing', 'stt'].includes(normalized)) return 1;
  return 0;
}

function lastMeaningfulEvent(events) {
  return [...(Array.isArray(events) ? events : [])]
    .filter((event) => event && event.stage)
    .sort((a, b) => timestamp(a.created_at, 0) - timestamp(b.created_at, 0))
    .at(-1) || null;
}

export function isProgressTerminalStatus(status) {
  return TERMINAL_STATUSES.has(String(status || '').toLowerCase());
}

export function shouldTrackJobProgress(snapshot) {
  return ['pending', 'queued', 'processing', 'analyzing'].includes(String(snapshot?.status || '').toLowerCase());
}

export function nextProgressPollDelay(attempt, { baseMs = 3000, maxMs = 15000 } = {}) {
  const safeAttempt = Math.max(0, Number.parseInt(attempt, 10) || 0);
  return Math.min(maxMs, baseMs * (2 ** Math.min(safeAttempt, 4)));
}

export function remainingEtaSeconds({ etaTotalSeconds, startedAt, now = Date.now() }) {
  const total = Math.max(0, Number(etaTotalSeconds) || 0);
  const started = timestamp(startedAt, now);
  return total - Math.max(0, (now - started) / 1000);
}

export function deriveJobProgress(snapshot, now = Date.now()) {
  const status = String(snapshot?.status || '').toLowerCase();
  const events = Array.isArray(snapshot?.events) ? snapshot.events : [];
  const latestEvent = lastMeaningfulEvent(events);
  const eventStep = stageStep(latestEvent?.stage);
  const hasDiarization = Boolean(snapshot?.diarize);
  const hasAnalysis = snapshot?.auto_analyze !== false;

  let activeStep = eventStep;
  let state = 'running';
  let done = false;

  if (snapshot?.budget_stop_state && snapshot.budget_stop_state !== 'none') {
    activeStep = Math.min(eventStep || 1, 3);
    done = true;
    state = 'budget_stopped';
  } else if (status === 'completed') {
    activeStep = 4;
    done = true;
    state = 'completed';
  } else if (status === 'transcribed') {
    activeStep = hasDiarization ? 2 : hasAnalysis ? 3 : 4;
    done = !hasDiarization && !hasAnalysis;
    state = hasDiarization ? 'waiting_for_speakers' : hasAnalysis ? 'waiting_for_analysis' : 'completed';
  } else if (status === 'analyzing') {
    activeStep = 3;
  } else if (status === 'processing') {
    activeStep = Math.max(1, Math.min(eventStep, 2));
  } else if (status === 'pending' || status === 'queued') {
    activeStep = Math.max(0, Math.min(eventStep, 1));
  } else if (status === 'error') {
    activeStep = Math.min(eventStep || 1, 3);
    state = 'error';
  } else if (status === 'cancelled' || status === 'canceled') {
    activeStep = Math.min(eventStep || 1, 3);
    state = 'cancelled';
  } else if (!status) {
    state = 'unavailable';
  }

  if (!hasDiarization && activeStep === 2) activeStep = hasAnalysis ? 3 : 4;
  if (!hasAnalysis && activeStep === 3) activeStep = 4;

  const createdAt = timestamp(snapshot?.created_at, now);
  const stageStartedAt = timestamp(latestEvent?.created_at, timestamp(snapshot?.updated_at, createdAt));
  const completedExpected = JOB_PROGRESS_STEPS.slice(0, activeStep)
    .reduce((sum, step) => sum + BASE_STEP_SECONDS[step.key], 0);
  const observedCompleted = Math.max(0, (stageStartedAt - createdAt) / 1000);
  const pace = completedExpected > 0
    ? Math.max(0.5, Math.min(3, observedCompleted / completedExpected))
    : 1;
  const remainingKeys = JOB_PROGRESS_STEPS.slice(activeStep)
    .map((step) => step.key)
    .filter((key) => (key !== 'diarization' || hasDiarization) && (key !== 'analysis' || hasAnalysis));
  const etaTotalSeconds = done || state === 'error' || state === 'cancelled' || state === 'budget_stopped'
    ? 0
    : Math.max(1, Math.round(remainingKeys.reduce((sum, key) => sum + BASE_STEP_SECONDS[key], 0) * pace));

  return {
    steps: JOB_PROGRESS_STEPS,
    activeStep,
    done,
    state,
    etaSeconds: etaTotalSeconds,
    etaTotalSeconds,
    startedAt: new Date(stageStartedAt).toISOString(),
    latestEventId: latestEvent?.id || null,
  };
}
