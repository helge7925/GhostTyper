import { query } from '../../../../lib/db';
import { enforceRateLimit, logApiError } from '../../../../lib/api-utils';
import { resolveShareToken } from '../../../../lib/share-tokens';
import { resolveActiveProviderConfig } from '../../../../lib/ai-provider-router';
import { synthesizeSpeechEdenAi } from '../../../../lib/edenai-service';
import {
  assertTranscriptionPaidWorkActive,
  budgetIdempotencyKey,
  composeAbortSignals,
  executeReservedSpend,
  paidJobAbortSignal,
  requestBudgetScope,
} from '../../../../lib/budget-runtime';
import {
  openRouterTts,
  buildWavHeader,
} from '../../../../lib/tts';
import { logError, logInfo } from '../../../../lib/observability';
import {
  acquireStreamSlot,
  assertOrgTtsShareBudget,
  ShareConcurrencyLimitError,
  ShareDailyBudgetError,
} from '../../../../lib/share-stream-guards';

/**
 * Public TTS stream for share-link viewers.
 *
 *   GET /api/share/:token/audio?lang=en
 *
 * Mirrors the authenticated `/api/transcriptions/[id]/audio` endpoint
 * but accepts a share-token in place of the org-scoped session, and
 * looks up the upstream Mistral key against the row owner's settings
 * (the share viewer doesn't have one of their own — costs accrue to
 * the workspace that issued the share).
 *
 * Stops on token revocation, idle-after-completion (30 s), client
 * disconnect, or the 4 h hard cap.
 */
const POLL_INTERVAL_MS = 1_000;
const IDLE_GRACE_MS = 30_000;
const HARD_TIMEOUT_MS = 4 * 60 * 60 * 1000;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }

  const token = String(req.query.token || '').trim();
  const requestedLang = String(req.query.lang || '').slice(0, 8).toLowerCase().trim() || null;
  if (!requestedLang) return res.status(400).json({ code: 'INVALID_PARAMS' });

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'share-audio',
    // Bucket per-token so one shared link can't host more than 10
    // simultaneous public listeners. Audit-loggable upper bound.
    identifier: `tok:${token.slice(0, 16)}`,
    limit: 10,
    windowMs: 60_000,
  });
  if (!allowed) return;

  let row;
  try {
    row = await resolveShareToken(token);
  } catch (error) {
    logApiError('share audio token lookup failed', error);
    return res.status(500).json({ code: 'INTERNAL' });
  }
  if (!row) return res.status(404).json({ code: 'NOT_FOUND' });
  if (row.budget_stop_state !== 'none') return res.status(429).json({ code: 'BUDGET_STOPPED' });
  if (!row.translation_config?.enabled) {
    return res.status(400).json({ code: 'TRANSLATION_DISABLED' });
  }

  // H8: cap simultaneous TTS streams per share token *and* check the org's
  // daily live_tts_share budget *before* we hand back any keys or open a
  // long-lived response. Both checks happen pre-flight so an attacker can't
  // chain rapid 4 h connections to drain the row owner's Mistral budget.
  let releaseSlot;
  try {
    releaseSlot = acquireStreamSlot(token, 'audio', 3);
  } catch (error) {
    if (error instanceof ShareConcurrencyLimitError) {
      return res.status(429).json({ code: 'CONCURRENCY_LIMIT' });
    }
    throw error;
  }
  try {
    await assertOrgTtsShareBudget(row.organization_id);
  } catch (error) {
    releaseSlot();
    if (error instanceof ShareDailyBudgetError) {
      return res.status(429).json({
        code: 'BUDGET_EXHAUSTED',
        usedSeconds: error.usedSeconds,
        limitSeconds: error.limitSeconds,
      });
    }
    throw error;
  }

  // Use the row owner's TTS provider config — share viewers don't have
  // one, and the workspace that owns the meeting pays for the TTS bytes.
  const active = await resolveActiveProviderConfig({
    userId: row.user_id,
    organizationId: row.organization_id,
    capability: 'tts',
  });
  const apiKey = active.apiKey;
  const ttsModel = active.provider === 'edenai' ? active.model : active.defaultModels.tts;
  const ttsVoice = active.ttsVoices[ttsModel];
  if (!apiKey) {
    releaseSlot();
    return res.status(503).json({ code: 'NO_API_KEY' });
  }

  res.status(200);
  res.setHeader('Content-Type', 'audio/wav');
  res.setHeader('Cache-Control', 'no-store, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write(buildWavHeader());

  let lastIdx = 0;
  let lastSawSegmentAt = Date.now();
  let totalPcmBytes = 0;
  let cancelled = false;
  const startedAt = Date.now();
  const transcriptionId = row.id;
  const ownerUserId = row.user_id;
  const orgId = row.organization_id;
  const streamScope = requestBudgetScope(req, 'live-tts-share', { transcriptionId, requestedLang, token });
  const disconnectController = new AbortController();
  const jobSignal = paidJobAbortSignal(transcriptionId, { organizationId: orgId, userId: ownerUserId });
  const signal = composeAbortSignals(disconnectController.signal, jobSignal);

  const cleanup = (reason) => {
    if (cancelled) return;
    cancelled = true;
    disconnectController.abort();
    clearInterval(interval);
    try { res.end(); } catch { /* ignore */ }
    releaseSlot();
    logInfo('share_audio.closed', { transcriptionId, reason, totalPcmBytes });
  };

  req.on('close', () => cleanup('client_close'));

  const interval = setInterval(async () => {
    if (cancelled) return;
    if (Date.now() - startedAt > HARD_TIMEOUT_MS) {
      cleanup('hard_timeout');
      return;
    }

    try {
      // Re-check the token on every poll so revocation kicks the
      // listener within ~POLL_INTERVAL_MS.
      const fresh = await resolveShareToken(token);
      if (!fresh) {
        cleanup('token_revoked_or_expired');
        return;
      }
      const segs = Array.isArray(fresh.translated_segments)
        ? fresh.translated_segments
        : [];
      const status = fresh.status;
      if (fresh.budget_stop_state && fresh.budget_stop_state !== 'none') {
        cleanup('budget_stop');
        return;
      }

      const matching = [];
      for (let i = lastIdx; i < segs.length; i++) {
        const seg = segs[i];
        if ((seg.language || '').toLowerCase() === requestedLang) {
          matching.push({ seg, index: i });
        }
      }
      lastIdx = segs.length;

      if (matching.length === 0) {
        const ended = !['pending', 'processing'].includes(status);
        if (ended && Date.now() - lastSawSegmentAt > IDLE_GRACE_MS) {
          cleanup('idle_after_completion');
        }
        return;
      }
      lastSawSegmentAt = Date.now();

      for (const { seg, index } of matching) {
        if (cancelled) return;
        if (signal.aborted) {
          cleanup('paid_work_aborted');
          return;
        }
        try {
          const chars = Array.from(String(seg.text || '')).length;
          if (!chars) continue;
          const paid = await executeReservedSpend(
            {
              idempotencyKey: budgetIdempotencyKey(
                'share-tts-segment', streamScope, index, seg.start, seg.end, seg.text,
              ),
              organizationId: orgId,
              userId: ownerUserId,
              transcriptionId,
              operation: 'live_tts_share',
              provider: active.provider,
              model: ttsModel,
              estimatedUsage: { inputQuantity: 0, outputQuantity: chars },
              reservationMs: 5 * 60 * 1000,
              stopOnDenied: true,
            },
            async (_reservation, budgetSignal) => {
              const rendered = active.provider === 'edenai'
                ? await synthesizeSpeechEdenAi({
                  text: seg.text,
                  format: 'pcm',
                  apiKey,
                  model: ttsModel,
                  voice: ttsVoice,
                  signal: composeAbortSignals(signal, budgetSignal),
                })
                : await openRouterTts({
                  text: seg.text,
                  language: requestedLang,
                  format: 'pcm',
                  apiKey,
                  model: ttsModel,
                  voice: ttsVoice,
                  signal: composeAbortSignals(signal, budgetSignal),
                });
              return {
                pcm: rendered,
                model: ttsModel,
                providerRequestId: rendered.providerRequestId || null,
                usage: rendered.usage || null,
              };
            },
            (result) => result.usage || ({ inputQuantity: 0, outputQuantity: chars }),
          );
          const pcm = paid.pcm;
          await assertTranscriptionPaidWorkActive(transcriptionId);
          if (pcm.length > 0 && !cancelled) {
            const ok = res.write(pcm);
            totalPcmBytes += pcm.length;
            if (!ok) await new Promise((resolve) => res.once('drain', resolve));
          }
        } catch (error) {
          logError('share_audio.tts_chunk_failed', error, { transcriptionId, language: requestedLang });
          if (['BUDGET_EXCEEDED', 'BUDGET_ACCOUNTING_UNAVAILABLE', 'PRICING_CONFIGURATION_MISSING', 'PAID_JOB_CANCELLED'].includes(error?.code)) {
            cleanup('paid_work_blocked');
            return;
          }
        }
      }
    } catch (error) {
      logApiError(`share_audio poll for ${transcriptionId} failed`, error);
    }
  }, POLL_INTERVAL_MS);

  if (interval.unref) interval.unref();
}
