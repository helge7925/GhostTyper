/**
 * Next.js instrumentation hook — runs once per server process on boot.
 *
 * Kicks the in-process background workers so a freshly (re)started instance
 * self-heals without waiting for the first HTTP request:
 *   - the Vexa reconcile worker re-attaches live bridges to still-running
 *     meetings and finalises ended ones,
 *   - the transcription worker drains any queued upload jobs.
 *
 * Node runtime only. Keep Node imports in the explicit nodejs branch so the
 * Edge bundle can eliminate pg, crypto and the long-lived timer workers.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { ensureVexaReconcileWorkerRunning } = await import('./lib/vexa-reconcile-worker');
      ensureVexaReconcileWorkerRunning();
    } catch (error) {
      console.error('[instrumentation] Vexa reconcile worker autostart failed', error);
    }

    try {
      const { ensureTranscriptionWorkerRunning } = await import('./lib/transcription-worker');
      ensureTranscriptionWorkerRunning();
    } catch (error) {
      console.error('[instrumentation] transcription worker autostart failed', error);
    }

    try {
      const { ensureBudgetStopWorkerRunning } = await import('./lib/budget-stop-worker');
      ensureBudgetStopWorkerRunning();
    } catch (error) {
      console.error('[instrumentation] budget stop worker autostart failed', error);
    }
  }
}
