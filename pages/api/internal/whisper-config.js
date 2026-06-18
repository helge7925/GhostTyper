import crypto from 'crypto';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { resolveBridgeTranscriptionConfig } from '../../../lib/integrations';
import { parseContextBias } from '../../../lib/context-bias';
import { logAuditEvent } from '../../../lib/audit-log';

function headerValue(raw) {
  if (Array.isArray(raw)) return raw[0] || '';
  return typeof raw === 'string' ? raw : '';
}

/**
 * Bridge-only callback. The transcription bridge container POSTs here on
 * each transcription (cached ~60s) to fetch the current effective Cortecs
 * key/model plus the workspace-global context bias. This is what makes
 * the admin UI key edits actually take effect at runtime — without it,
 * the bridge would still hold whatever key it was started with.
 *
 * Authentication: shared secret in BRIDGE_SHARED_SECRET. Same secret has
 * to be present in the bridge container env. We use timing-safe compare.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }

  // Defense-in-depth: Docker internal network is normally trusted, but
  // rate-limit against a compromised bridge container.
  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'internal-whisper-config',
    identifier: `${headerValue(req.headers['x-romaco-org']).trim() || 'unknown'}:${req.socket?.remoteAddress || 'unknown'}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!allowed) return;

  const expected = process.env.BRIDGE_SHARED_SECRET;
  if (!expected) {
    return res.status(503).json({ code: 'BRIDGE_SECRET_MISSING' });
  }

  const provided = req.headers['x-bridge-secret'];
  if (typeof provided !== 'string' || provided.length !== expected.length) {
    return res.status(401).json({ code: 'UNAUTHORIZED' });
  }
  let ok;
  try {
    ok = crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    ok = false;
  }
  if (!ok) {
    return res.status(401).json({ code: 'UNAUTHORIZED' });
  }

  try {
    const orgHeader = headerValue(req.headers['x-romaco-org']).trim();
    const platformHeader = headerValue(req.headers['x-romaco-platform']).trim();
    const nativeMeetingHeader = headerValue(req.headers['x-romaco-native-meeting-id']).trim();
    const organizationId = /^\d+$/.test(orgHeader) ? Number(orgHeader) : null;

    const config = await resolveBridgeTranscriptionConfig({
      organizationId,
      platform: platformHeader || null,
      nativeMeetingId: nativeMeetingHeader || null,
    });
    if (!config.apiKey) {
      return res.status(503).json({ code: 'NO_KEY' });
    }
    if (config.source === 'operator') {
      await logAuditEvent({
        userId: null,
        organizationId: config.organizationId || null,
        action: 'bridge.transcription.operator_fallback',
        targetType: 'bridge_transcription',
        targetId: config.organizationId ? String(config.organizationId) : null,
        severity: 'warn',
        metadata: {
          source: 'operator',
          organizationId: config.organizationId || null,
          scope: 'bridge_transcription',
        },
      });
    }
    return res.status(200).json({
      apiKey: config.apiKey,
      provider: config.provider,
      baseUrl: config.baseUrl,
      model: config.model,
      contextBias: parseContextBias(config.contextBias),
      source: config.source,
      organizationId: config.organizationId,
    });
  } catch (error) {
    logApiError('whisper-config callback failed', error);
    return serverError(res, 'Konfig-Lookup fehlgeschlagen.');
  }
}
