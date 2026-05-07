import { resolveShareToken, buildShareUrl } from '../../../../lib/share-tokens';
import { buildQrSvg } from '../../../../lib/qr';
import { logApiError } from '../../../../lib/api-utils';

/**
 * Public QR-code endpoint for the bot-camera overlay page.
 *
 *   GET /api/share/:token/qr.svg → image/svg+xml
 *
 * Resolves the token (404 if unknown / expired) and returns an inline
 * SVG QR-code pointing at the public companion-tab URL. Used by
 * `/share/[token]/overlay` via a plain `<img>` so the overlay page
 * itself can stay fully client-side (no getServerSideProps + no DB
 * import in its module graph).
 *
 * Cache-Control: short (60 s) so a token revocation propagates without
 * forcing every visitor to bypass caches manually. The SVG content
 * itself doesn't change for the lifetime of a token, so we don't need
 * a no-store policy.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }
  const token = String(req.query.token || '').trim();
  let row;
  try {
    row = await resolveShareToken(token);
  } catch (error) {
    logApiError('share QR token lookup failed', error);
    return res.status(500).json({ code: 'INTERNAL' });
  }
  if (!row) return res.status(404).json({ code: 'NOT_FOUND' });

  const shareUrl = buildShareUrl(token);
  let svg;
  try {
    svg = await buildQrSvg(shareUrl, { size: 360 });
  } catch (error) {
    logApiError('share QR render failed', error);
    return res.status(500).json({ code: 'QR_RENDER_FAILED' });
  }
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.status(200).send(svg);
}
