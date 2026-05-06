import { query } from '../../../../lib/db';
import { enforceRateLimit, logApiError } from '../../../../lib/api-utils';
import { resolveShareToken } from '../../../../lib/share-tokens';
import { resolveMistralApiKey } from '../../../../lib/settings-service';
import { logUsage } from '../../../../lib/usage';
import {
  voxtralTts,
  buildWavHeader,
  estimatePcmDurationSeconds,
  PCM_SAMPLE_RATE,
  PCM_CHANNELS,
  PCM_BITS_PER_SAMPLE,
} from '../../../../lib/tts';
import { logError, logInfo } from '../../../../lib/observability';

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
  if (!row.translation_config?.enabled) {
    return res.status(400).json({ code: 'TRANSLATION_DISABLED' });
  }

  // Use the row owner's Mistral key — share viewers don't have one,
  // and the workspace that owns the meeting pays for the TTS bytes.
  const apiKey = await resolveMistralApiKey({
    userId: row.user_id,
    organizationId: row.organization_id,
  });
  if (!apiKey) return res.status(503).json({ code: 'NO_API_KEY' });

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

  const cleanup = (reason) => {
    if (cancelled) return;
    cancelled = true;
    clearInterval(interval);
    try { res.end(); } catch { /* ignore */ }
    if (totalPcmBytes > 0) {
      const seconds = estimatePcmDurationSeconds(totalPcmBytes);
      logUsage(ownerUserId, 'voxtral-tts-latest', 'live_tts_share', {
        input_tokens: Math.ceil(seconds),
        output_tokens: 0,
      }, orgId).catch((err) => logError('share_audio.usage_log_failed', err));
    }
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

      const matching = [];
      for (let i = lastIdx; i < segs.length; i++) {
        const seg = segs[i];
        if ((seg.language || '').toLowerCase() === requestedLang) {
          matching.push(seg);
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

      for (const seg of matching) {
        if (cancelled) return;
        try {
          const pcm = await voxtralTts({
            text: seg.text,
            language: requestedLang,
            format: 'pcm',
            apiKey,
          });
          if (pcm.length > 0 && !cancelled) {
            const ok = res.write(pcm);
            totalPcmBytes += pcm.length;
            if (!ok) await new Promise((resolve) => res.once('drain', resolve));
          }
        } catch (error) {
          logError('share_audio.tts_chunk_failed', error, { transcriptionId, language: requestedLang });
        }
      }
    } catch (error) {
      logApiError(`share_audio poll for ${transcriptionId} failed`, error);
    }
  }, POLL_INTERVAL_MS);

  if (interval.unref) interval.unref();
}
