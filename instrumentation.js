/**
 * Next.js instrumentation hook — runs once per server process on boot.
 *
 * Kicks the in-process background workers so a freshly (re)started instance
 * self-heals without waiting for the first HTTP request:
 *   - the Vexa reconcile worker re-attaches live bridges to still-running
 *     meetings and finalises ended ones,
 *   - the transcription worker drains any queued upload jobs.
 *
 * Node runtime only. The Edge runtime can run instrumentation too, but these
 * workers need the pg pool + long-lived timers, so we bail there. Each
 * import is dynamic + guarded so a bootstrap failure can never crash server
 * startup — the lazy `ensure*Running()` calls from request handlers remain
 * the fallback.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

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
}
