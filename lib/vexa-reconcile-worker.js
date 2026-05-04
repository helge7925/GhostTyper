/**
 * In-process reconcile worker for Vexa-backed meetings.
 *
 * Vexa-Lite refuses to register webhooks targeting RFC1918 addresses
 * (SSRF protection), so in our local Docker setup the
 * `meeting.completed` webhook never reaches our webapp. The bridge in
 * `lib/vexa-bridge.js` keeps the live transcript flowing during the
 * meeting, but it stops on bot exit — the final status transition and
 * the auto-analyze trigger are picked up here instead.
 *
 * In a public deployment (HTTPS domain), Vexa accepts the webhook and
 * this worker becomes a low-cost backstop for missed events.
 *
 * Lazy-started via `ensureVexaReconcileWorkerRunning()` from request
 * handlers (mirrors the transcription-worker pattern).
 */

import { runReconcileScan } from '../pages/api/admin/vexa/reconcile';
import { logError, logInfo } from './observability';

const SCAN_INTERVAL_MS = Number(process.env.VEXA_RECONCILE_INTERVAL_MS || 60_000);

let state = null;

function getState() {
  if (!state) state = { started: false, timer: null };
  return state;
}

async function tick() {
  try {
    const results = await runReconcileScan();
    if (results.length > 0) {
      logInfo('vexa_reconcile.scan', { processed: results.length });
    }
  } catch (error) {
    logError('vexa_reconcile.tick_failed', error);
  }
}

export function ensureVexaReconcileWorkerRunning() {
  const s = getState();
  if (s.started) return;
  s.started = true;
  logInfo('vexa_reconcile.started', { intervalMs: SCAN_INTERVAL_MS });
  // Don't keep the event loop alive just for this scheduler.
  s.timer = setInterval(() => {
    void tick();
  }, SCAN_INTERVAL_MS);
  if (s.timer.unref) s.timer.unref();
}
