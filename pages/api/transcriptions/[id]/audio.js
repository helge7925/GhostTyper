import { query } from '../../../../lib/db';
import { enforceRateLimit, logApiError } from '../../../../lib/api-utils';
import { withOrgScope } from '../../../../lib/api/with-org-scope';
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
 * GET /api/transcriptions/[id]/audio?lang=en
 *
 * Long-lived chunked HTTP response that streams TTS audio for every
 * `translated_segments` entry whose target language matches `lang`.
 * Browser side a `<audio src="…">` element consumes this URL: the WAV
 * header is sent once up front, then per-segment PCM bytes are appended
 * to the body as they're generated. The browser plays them as they
 * arrive — no JS polling needed.
 *
 * Polling cadence on the server (1 s) is independent of, and faster
 * than, Voxtral STT chunking; the bottleneck is the TTS round-trip.
 *
 * Stops automatically when:
 *  - the transcription's status leaves the live phase (completed,
 *    error) AND no new segments arrive for `IDLE_GRACE_MS`
 *  - the client disconnects (`req.on('close', …)`)
 *  - a hard cap of `HARD_TIMEOUT_MS` is reached
 */
const POLL_INTERVAL_MS = 1_000;
const IDLE_GRACE_MS = 30_000;
const HARD_TIMEOUT_MS = 4 * 60 * 60 * 1000;

async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }

  const orgId = req.org.id;
  const userId = req.userId;
  const transcriptionId = Number.parseInt(req.query.id, 10);
  const requestedLang = String(req.query.lang || '').slice(0, 8).toLowerCase().trim() || null;

  if (!Number.isFinite(transcriptionId) || !requestedLang) {
    return res.status(400).json({ code: 'INVALID_PARAMS' });
  }

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'audio-stream',
    identifier: `org:${orgId}:user:${userId}`,
    // Budget: at most 10 concurrent live audio streams per user — this
    // is a long-lived response, not a per-request cost.
    limit: 10,
    windowMs: 60_000,
  });
  if (!allowed) return;

  // Confirm the row exists, belongs to this org, and is a vexa meeting
  // with translation enabled.
  const row = await query(
    `SELECT id, source, translation_config, status
       FROM transcriptions
      WHERE id = $1 AND organization_id = $2`,
    [transcriptionId, orgId],
  );
  if (!row.rows.length) return res.status(404).json({ code: 'NOT_FOUND' });
  const meta = row.rows[0];
  if (meta.source !== 'vexa') return res.status(400).json({ code: 'NOT_A_MEETING' });
  if (!meta.translation_config?.enabled) {
    return res.status(400).json({ code: 'TRANSLATION_DISABLED' });
  }

  const apiKey = await resolveMistralApiKey({ userId, organizationId: orgId });
  if (!apiKey) return res.status(503).json({ code: 'NO_API_KEY' });

  // Open the streaming response. We send a WAV header up front so the
  // browser's <audio> element can decode each appended PCM chunk
  // without re-negotiating.
  res.status(200);
  res.setHeader('Content-Type', 'audio/wav');
  res.setHeader('Cache-Control', 'no-store, no-transform');
  res.setHeader('X-Accel-Buffering', 'no'); // disable buffering through Nginx/Traefik
  res.flushHeaders?.();
  res.write(buildWavHeader());

  let lastIdx = 0;
  let lastSawSegmentAt = Date.now();
  let totalPcmBytes = 0;
  let cancelled = false;
  const startedAt = Date.now();

  const cleanup = (reason) => {
    if (cancelled) return;
    cancelled = true;
    clearInterval(interval);
    try {
      res.end();
    } catch {
      /* ignore */
    }
    if (totalPcmBytes > 0) {
      const seconds = estimatePcmDurationSeconds(totalPcmBytes, {
        sampleRate: PCM_SAMPLE_RATE,
        channels: PCM_CHANNELS,
        bitsPerSample: PCM_BITS_PER_SAMPLE,
      });
      logUsage(userId, 'voxtral-tts-latest', 'live_tts', {
        // Per-second billing; logUsage stores the audio duration in
        // input_tokens by convention for audio operations (mirrors
        // how `meeting_transcription` is logged today).
        input_tokens: Math.ceil(seconds),
        output_tokens: 0,
      }, orgId).catch((err) => logError('audio_stream.usage_log_failed', err));
    }
    logInfo('audio_stream.closed', { transcriptionId, reason, totalPcmBytes });
  };

  req.on('close', () => cleanup('client_close'));

  const interval = setInterval(async () => {
    if (cancelled) return;
    if (Date.now() - startedAt > HARD_TIMEOUT_MS) {
      cleanup('hard_timeout');
      return;
    }

    try {
      const r = await query(
        `SELECT translated_segments, status FROM transcriptions WHERE id = $1`,
        [transcriptionId],
      );
      const segs = Array.isArray(r.rows[0]?.translated_segments)
        ? r.rows[0].translated_segments
        : [];
      const status = r.rows[0]?.status || meta.status;

      // Filter to segments matching the requested language and beyond
      // the cursor.
      const matching = [];
      for (let i = lastIdx; i < segs.length; i++) {
        const seg = segs[i];
        if ((seg.language || '').toLowerCase() === requestedLang) {
          matching.push(seg);
        }
      }
      lastIdx = segs.length;

      if (matching.length === 0) {
        // No new audio for this language. If the meeting has ended and
        // we've been idle long enough, terminate the stream so the
        // browser closes its <audio> element cleanly.
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
            // Back-pressure: if the kernel buffer fills, wait for drain
            // before pushing the next chunk so we don't blow up memory.
            if (!ok) await new Promise((resolve) => res.once('drain', resolve));
          }
        } catch (error) {
          logError('audio_stream.tts_chunk_failed', error, { transcriptionId, language: requestedLang });
          // Keep going; missing one segment is better than killing the stream.
        }
      }
    } catch (error) {
      logApiError(`audio_stream poll for ${transcriptionId} failed`, error);
    }
  }, POLL_INTERVAL_MS);

  if (interval.unref) interval.unref();
}

export default withOrgScope({ permission: 'transcription.read' }, handler);
