import { query } from '../../../../lib/db';
import { enforceRateLimit, logApiError } from '../../../../lib/api-utils';
import { resolveShareToken } from '../../../../lib/share-tokens';
import {
  acquireStreamSlot,
  ShareConcurrencyLimitError,
} from '../../../../lib/share-stream-guards';

/**
 * Public SSE stream for the share-link companion view. Pushes the
 * same translation-only snapshot payload as `/api/share/[token]` —
 * but as a long-lived event-stream so the public page can react
 * without polling.
 *
 * Design:
 * - Re-resolves the token on every poll so an admin revoke takes
 *   effect within ~POLL_INTERVAL_MS without us having to keep a
 *   subscription/registry.
 * - Closes immediately if the token is gone or expired (sends a final
 *   `closed` event with a reason so the client can decide whether to
 *   show "Meeting beendet" vs. "Link abgelaufen").
 * - No auth wrapper, no org scope — token is the capability.
 */
const POLL_INTERVAL_MS = 1500;
const HEARTBEAT_MS = 15_000;

function writeSseEvent(res, eventName, payload) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function buildSignature(row) {
  const segCount = Array.isArray(row.segments) ? row.segments.length : 0;
  const trCount = Array.isArray(row.translated_segments) ? row.translated_segments.length : 0;
  return `${row.status || ''}|s${segCount}|t${trCount}`;
}

function projectSnapshot(row) {
  return {
    status: row.status,
    segments: Array.isArray(row.segments) ? row.segments : [],
    translatedSegments: Array.isArray(row.translated_segments) ? row.translated_segments : [],
    translationConfig: row.translation_config || null,
    meetingStartedAt: row.meeting_started_at,
    meetingEndedAt: row.meeting_ended_at,
    expiresAt: row.public_share_expires_at,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }

  const token = String(req.query.token || '').trim();

  // H8: stream.js previously had no rate-limit at all and no concurrency cap.
  // Mirror the audio endpoint shape — per-token bucket so a single share
  // link can't host an unbounded number of public viewers, plus a hard cap
  // of 5 simultaneous SSE streams per token (slightly higher than the audio
  // cap of 3 because SSE has no Mistral cost — only memory/CPU footprint).
  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'share-stream',
    identifier: `tok:${token.slice(0, 16)}`,
    limit: 20,
    windowMs: 60_000,
  });
  if (!allowed) return;

  let initial;
  try {
    initial = await resolveShareToken(token);
  } catch (error) {
    logApiError('share stream initial lookup failed', error);
    return res.status(500).json({ code: 'INTERNAL' });
  }
  if (!initial) return res.status(404).json({ code: 'NOT_FOUND' });

  let releaseSlot;
  try {
    releaseSlot = acquireStreamSlot(token, 'stream', 5);
  } catch (error) {
    if (error instanceof ShareConcurrencyLimitError) {
      return res.status(429).json({ code: 'CONCURRENCY_LIMIT' });
    }
    throw error;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  let lastSignature = '';
  let cancelled = false;

  const sendSnapshot = (row) => {
    const sig = buildSignature(row);
    if (sig === lastSignature) return;
    lastSignature = sig;
    writeSseEvent(res, 'snapshot', projectSnapshot(row));
  };

  // Initial push.
  sendSnapshot(initial);

  const heartbeat = setInterval(() => {
    if (cancelled) return;
    res.write(': heartbeat\n\n');
  }, HEARTBEAT_MS);

  const tick = setInterval(async () => {
    if (cancelled) return;
    try {
      const row = await resolveShareToken(token);
      if (!row) {
        // Token was revoked or has expired. Tell the client and close.
        writeSseEvent(res, 'closed', { reason: 'token_revoked_or_expired' });
        cleanup();
        return;
      }
      sendSnapshot(row);
    } catch (error) {
      logApiError('share stream tick failed', error);
    }
  }, POLL_INTERVAL_MS);

  const cleanup = () => {
    if (cancelled) return;
    cancelled = true;
    clearInterval(tick);
    clearInterval(heartbeat);
    try { res.end(); } catch { /* ignore */ }
    releaseSlot();
  };

  req.on('close', cleanup);
}
