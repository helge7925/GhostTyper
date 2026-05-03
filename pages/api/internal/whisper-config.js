import crypto from 'crypto';
import { logApiError, serverError } from '../../../lib/api-utils';
import { resolveFireworksConfig } from '../../../lib/integrations';

/**
 * Bridge-only callback. The fireworks-bridge container POSTs here on each
 * transcription (cached ~60s) to fetch the current effective Fireworks
 * key. This is what makes the admin UI key edits actually take effect at
 * runtime — without it, the bridge would still hold whatever key it was
 * started with.
 *
 * Authentication: shared secret in BRIDGE_SHARED_SECRET. Same secret has
 * to be present in the bridge container env. We use timing-safe compare.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }

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
    const config = await resolveFireworksConfig();
    if (!config.apiKey) {
      return res.status(503).json({ code: 'NO_KEY' });
    }
    return res.status(200).json({
      apiKey: config.apiKey,
      model: config.model,
      source: config.source,
    });
  } catch (error) {
    logApiError('whisper-config callback failed', error);
    return serverError(res, 'Konfig-Lookup fehlgeschlagen.');
  }
}
